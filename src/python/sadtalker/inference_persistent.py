from glob import glob
import shutil
import torch
from time import strftime
import os, sys, time
from argparse import ArgumentParser
import platform
import gc
import imageio
import threading
import cv2
import pyaudio
import wave
import screeninfo
import tempfile
import ffmpeg
import subprocess

from src.utils.preprocess import CropAndExtract
from src.test_audio2coeff import Audio2Coeff  
from src.facerender.animate import AnimateFromCoeff
from src.facerender.pirender_animate import AnimateFromCoeff_PIRender
from src.generate_batch import get_data
from src.generate_facerender_batch import get_facerender_data
from src.utils.init_path import init_path

import queue

import torch
import torchvision
print(torch.__version__, torchvision.__version__)

play_lock = threading.Lock()
video_queue = queue.Queue()


def center_window(window_name, window_width, window_height):
    screen = screeninfo.get_monitors()[0]
    screen_width = screen.width
    screen_height = screen.height

    x_pos = int((screen_width - window_width) / 2)
    y_pos = int((screen_height - window_height) / 2)

    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, window_width, window_height)
    cv2.moveWindow(window_name, x_pos, y_pos)


def display_video_with_audio(video_file, window_width=None, window_height=None, source_image=None):
    # Add video file to the queue
    video_queue.put((video_file, window_width, window_height, source_image))
    threading.Thread(target=process_video_queue, daemon=True).start()


def process_video_queue():
    while not video_queue.empty():
        video_file, window_width, window_height, source_image = video_queue.get()
        with play_lock:
            play_video(video_file, window_width, window_height, source_image)


def play_video(video_file, window_width, window_height, source_image):
    # Buffer video file content to ensure stability
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_video_file:
        with open(video_file, 'rb') as original_file:
            temp_video_file.write(original_file.read())
        buffered_video_file = temp_video_file.name

    cap = cv2.VideoCapture(buffered_video_file)
    if not cap.isOpened():
        print(f"Error: Unable to open video file {video_file}", file=sys.stderr)
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0:
        print("Error: Could not retrieve video frame rate", file=sys.stderr)
        return

    print(f"Video Frame Rate: {fps} FPS")

    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if source_image is not None:
        source_frame_height, source_frame_width = source_image.shape[:2]
        aspect_ratio = source_frame_width / source_frame_height
    else:
        aspect_ratio = frame_width / frame_height

    if window_width and window_height:
        if window_width / window_height > aspect_ratio:
            new_height = int(window_width / aspect_ratio)
            new_width = window_width
        else:
            new_width = int(window_height * aspect_ratio)
            new_height = window_height
    elif window_width:
        new_width = window_width
        new_height = int(window_width / aspect_ratio)
    elif window_height:
        new_height = window_height
        new_width = int(window_height * aspect_ratio)
    else:
        new_width = int(frame_height * aspect_ratio)
        new_height = frame_height

    window_name = "Generated Video"
    center_window(window_name, new_width, new_height)

    # Start audio playback in a separate thread
    audio_thread = threading.Thread(target=play_audio_from_video, args=(buffered_video_file,))
    audio_thread.start()

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        cv2.imshow(window_name, frame)
        cv2.setWindowProperty(window_name, cv2.WND_PROP_TOPMOST, 1)

        if cv2.waitKey(int(750 / fps)) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


def play_audio_from_video(video_path):
    try:
        temp_audio_file = tempfile.mktemp(suffix='.wav')

        ffmpeg.input(video_path).output(temp_audio_file, acodec='pcm_s16le', ar='44100', ac=2, vn=None).run(overwrite_output=True)
        play_audio(temp_audio_file)

    except Exception as e:
        print(f"Error while extracting audio from video: {e}", file=sys.stderr)


def play_audio(audio_path):
    try:
        wf = wave.open(audio_path, 'rb')

        p = pyaudio.PyAudio()
        stream = p.open(format=p.get_format_from_width(wf.getsampwidth()),
                        channels=wf.getnchannels(),
                        rate=wf.getframerate(),
                        output=True)

        chunk = 1024
        data = wf.readframes(chunk)
        while data:
            stream.write(data)
            data = wf.readframes(chunk)

        stream.stop_stream()
        stream.close()
        p.terminate()

    except Exception as e:
        print(f"Error while playing audio: {e}", file=sys.stderr)


def process_task(args, preprocess_model, audio_to_coeff, animate_from_coeff):
    pic_path = args.source_image
    audio_path = args.driven_audio
    save_dir = os.path.join(args.result_dir, strftime("%Y_%m_%d_%H.%M.%S"))
    os.makedirs(save_dir, exist_ok=True)
    pose_style = args.pose_style
    device = args.device
    batch_size = args.batch_size
    input_yaw_list = args.input_yaw
    input_pitch_list = args.input_pitch
    input_roll_list = args.input_roll
    ref_eyeblink = args.ref_eyeblink
    ref_pose = args.ref_pose

    first_frame_dir = os.path.join(save_dir, 'first_frame_dir')
    os.makedirs(first_frame_dir, exist_ok=True)
    print('3DMM Extraction for source image')
    first_coeff_path, crop_pic_path, crop_info =  preprocess_model.generate(pic_path, first_frame_dir, args.preprocess,\
                                                                             source_image_flag=True, pic_size=args.size)
    if first_coeff_path is None:
        print("Can't get the coeffs of the input")
        return

    if ref_eyeblink is not None:
        ref_eyeblink_videoname = os.path.splitext(os.path.split(ref_eyeblink)[-1])[0]
        ref_eyeblink_frame_dir = os.path.join(save_dir, ref_eyeblink_videoname)
        os.makedirs(ref_eyeblink_frame_dir, exist_ok=True)
        print('3DMM Extraction for the reference video providing eye blinking')
        ref_eyeblink_coeff_path, _, _ =  preprocess_model.generate(ref_eyeblink, ref_eyeblink_frame_dir, args.preprocess, source_image_flag=False)
    else:
        ref_eyeblink_coeff_path=None

    if ref_pose is not None:
        if ref_pose == ref_eyeblink: 
            ref_pose_coeff_path = ref_eyeblink_coeff_path
        else:
            ref_pose_videoname = os.path.splitext(os.path.split(ref_pose)[-1])[0]
            ref_pose_frame_dir = os.path.join(save_dir, ref_pose_videoname)
            os.makedirs(ref_pose_frame_dir, exist_ok=True)
            print('3DMM Extraction for the reference video providing pose')
            ref_pose_coeff_path, _, _ =  preprocess_model.generate(ref_pose, ref_pose_frame_dir, args.preprocess, source_image_flag=False)
    else:
        ref_pose_coeff_path=None

    batch = get_data(first_coeff_path, audio_path, device, ref_eyeblink_coeff_path, still=args.still)
    coeff_path = audio_to_coeff.generate(batch, save_dir, pose_style, ref_pose_coeff_path)

    if args.face3dvis:
        from src.face3d.visualize import gen_composed_video
        gen_composed_video(args, device, first_coeff_path, coeff_path, audio_path, os.path.join(save_dir, '3dface.mp4'))

    data = get_facerender_data(coeff_path, crop_pic_path, first_coeff_path, audio_path, 
                                batch_size, input_yaw_list, input_pitch_list, input_roll_list,
                                expression_scale=args.expression_scale, still_mode=args.still, preprocess=args.preprocess, size=args.size, facemodel=args.facerender)

    result = animate_from_coeff.generate(data, save_dir, pic_path, crop_info, \
                                enhancer=args.enhancer, background_enhancer=args.background_enhancer, preprocess=args.preprocess, img_size=args.size)

    shutil.move(result, save_dir+'.mp4')
    print('The generated video is named:', save_dir+'.mp4', flush=True)

    if not args.verbose:
        shutil.rmtree(save_dir)
    
    # # Automatically play the result video
    # print(f"Playing the video: {save_dir+'.mp4'}")
    # if sys.platform.startswith("win"):
    #     os.startfile(save_dir+'.mp4')  # Windows
    # elif sys.platform.startswith("darwin"):
    #     subprocess.run(["open", save_dir+'.mp4'])  # macOS
    # else:
    #     subprocess.run(["xdg-open", save_dir+'.mp4'])  # Linux
    if args.play == True:
        display_video_with_audio(save_dir+'.mp4', int(600), int(600))#, imageio.v3.imread(pic_path))


def main():
    # Initialize models and paths once before the loop starts
    parser = ArgumentParser()
    parser.add_argument("--driven_audio", default='./examples/driven_audio/bus_chinese.wav', help="path to driven audio")
    parser.add_argument("--source_image", default='./examples/source_image/full_body_1.png', help="path to source image")
    parser.add_argument("--ref_eyeblink", default=None, help="path to reference video providing eye blinking")
    parser.add_argument("--ref_pose", default=None, help="path to reference video providing pose")
    parser.add_argument("--checkpoint_dir", default='./checkpoints', help="path to output")
    parser.add_argument("--result_dir", default='./results', help="path to output")
    parser.add_argument("--pose_style", type=int, default=0,  help="input pose style from [0, 46)")
    parser.add_argument("--batch_size", type=int, default=2,  help="the batch size of facerender")
    parser.add_argument("--size", type=int, default=256,  help="the image size of the facerender")
    parser.add_argument("--expression_scale", type=float, default=1.,  help="the batch size of facerender")
    parser.add_argument('--input_yaw', nargs='+', type=int, default=None, help="the input yaw degree of the user ")
    parser.add_argument('--input_pitch', nargs='+', type=int, default=None, help="the input pitch degree of the user")
    parser.add_argument('--input_roll', nargs='+', type=int, default=None, help="the input roll degree of the user")
    parser.add_argument('--enhancer',  type=str, default=None, help="Face enhancer, [gfpgan, RestoreFormer]")
    parser.add_argument('--background_enhancer',  type=str, default=None, help="background enhancer, [realesrgan]")
    parser.add_argument("--cpu", dest="cpu", action="store_true") 
    parser.add_argument("--face3dvis", action="store_true", help="generate 3d face and 3d landmarks") 
    parser.add_argument("--still", action="store_true", help="can crop back to the original videos for the full body animation") 
    parser.add_argument("--preprocess", default='crop', choices=['crop', 'extcrop', 'resize', 'full', 'extfull'], help="how to preprocess the images" ) 
    parser.add_argument("--verbose", action="store_true", help="saving the intermediate output or not" ) 
    parser.add_argument("--old_version", action="store_true", help="use the pth other than safetensor version" ) 
    parser.add_argument("--facerender", default='pirender', choices=['pirender', 'facevid2vid'] ) 
    # Net structure and parameters
    parser.add_argument('--net_recon', type=str, default='resnet50', choices=['resnet18', 'resnet34', 'resnet50'], help='useless')
    parser.add_argument('--init_path', type=str, default=None, help='Useless')
    parser.add_argument('--use_last_fc', default=False, help='zero initialize the last fc')
    parser.add_argument('--bfm_folder', type=str, default='./checkpoints/BFM_Fitting/')
    parser.add_argument('--bfm_model', type=str, default='BFM_model_front.mat', help='bfm model')
    # Default renderer parameters
    parser.add_argument('--focal', type=float, default=1015.)
    parser.add_argument('--center', type=float, default=112.)
    parser.add_argument('--camera_d', type=float, default=10.)
    parser.add_argument('--z_near', type=float, default=5.)
    parser.add_argument('--z_far', type=float, default=15.)

    parser.add_argument('--device', default='cuda', choices=['cpu', 'cuda'], help='device to use')
    parser.add_argument('--play', default=True, help='play video after generation')

    args = parser.parse_args()

    # Initialize device configuration
    if torch.cuda.is_available() and not args.cpu:
        args.device = "cuda"
    elif platform.system() == 'Darwin' and args.facerender == 'pirender':  # macos
        args.device = "mps"
    else:
        args.device = "cpu"

    # Initialize models and paths only once
    current_root_path = os.path.split(sys.argv[0])[0]
    sadtalker_paths = init_path(args.checkpoint_dir, os.path.join(current_root_path, 'src/config'), args.size, args.old_version, args.preprocess)

    preprocess_model = CropAndExtract(sadtalker_paths, args.device)
    audio_to_coeff = Audio2Coeff(sadtalker_paths, args.device)

    if args.facerender == 'facevid2vid':
        animate_from_coeff = AnimateFromCoeff(sadtalker_paths, args.device)
    elif args.facerender == 'pirender':
        animate_from_coeff = AnimateFromCoeff_PIRender(sadtalker_paths, args.device)
    else:
        raise(RuntimeError('Unknown model: {}'.format(args.facerender)))
    print("SadTalker Service Ready")
    while True:
        torch.cuda.empty_cache()
        gc.collect()
        process_task(parser.parse_args(input().split()), preprocess_model, audio_to_coeff, animate_from_coeff)
        torch.cuda.empty_cache()
        gc.collect()


if __name__ == '__main__':
    main()

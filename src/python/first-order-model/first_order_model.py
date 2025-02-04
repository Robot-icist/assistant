import sys
import yaml
import torch
import imageio
import numpy as np
from skimage.transform import resize
from skimage import img_as_ubyte
from tqdm.auto import tqdm
from sync_batchnorm import DataParallelWithCallback
from modules.generator import OcclusionAwareGenerator
from modules.keypoint_detector import KPDetector
from animate import normalize_kp
import ffmpeg
import os
import subprocess
from tempfile import NamedTemporaryFile
import argparse
import wave
import pyaudio
import threading
import cv2
import tempfile
import gc
import warnings
import screeninfo

warnings.filterwarnings("ignore")

torch.cuda.set_per_process_memory_fraction(0.6, device=0)

models_loaded = False  # Flag to check if models are already loaded

def load_checkpoints(config_path, checkpoint_path, cpu=False):
    global generator, kp_detector, checkpoint, models_loaded
    
    if models_loaded:
        print("Models already loaded, skipping loading step.")
        return

    with open(config_path) as f:
        config = yaml.full_load(f)

    generator = OcclusionAwareGenerator(**config['model_params']['generator_params'],
                                        **config['model_params']['common_params'])
    if not cpu:
        generator.cuda()
   
    kp_detector = KPDetector(**config['model_params']['kp_detector_params'],
                                **config['model_params']['common_params'])
    if not cpu:
        kp_detector.cuda()

    if cpu:
        checkpoint = torch.load(checkpoint_path, map_location=torch.device('cpu'))
    else:
        checkpoint = torch.load(checkpoint_path)

    generator.load_state_dict(checkpoint['generator'])
    kp_detector.load_state_dict(checkpoint['kp_detector'])

    if not cpu:
        generator = DataParallelWithCallback(generator)
        kp_detector = DataParallelWithCallback(kp_detector)

    generator.eval()
    kp_detector.eval()

    models_loaded = True
    print("Models loaded successfully.")

def make_animation(source_image, driving_video, relative=True, adapt_movement_scale=True, cpu=False):
    with torch.no_grad():
        predictions = []
        source = torch.tensor(source_image[np.newaxis].astype(np.float32)).permute(0, 3, 1, 2)
        if not cpu:
            source = source.cuda()
        driving = torch.tensor(np.array(driving_video)[np.newaxis].astype(np.float32)).permute(0, 4, 1, 2, 3)
        kp_source = kp_detector(source)
        kp_driving_initial = kp_detector(driving[:, :, 0])

        for frame_idx in tqdm(range(driving.shape[2])):
            driving_frame = driving[:, :, frame_idx]
            if not cpu:
                driving_frame = driving_frame.cuda()
            kp_driving = kp_detector(driving_frame)
            kp_norm = normalize_kp(kp_source=kp_source, kp_driving=kp_driving,
                                   kp_driving_initial=kp_driving_initial, use_relative_movement=relative,
                                   use_relative_jacobian=relative, adapt_movement_scale=adapt_movement_scale)
            out = generator(source, kp_source=kp_source, kp_driving=kp_norm)

            predictions.append(np.transpose(out['prediction'].data.cpu().numpy(), [0, 2, 3, 1])[0])
    return predictions

import queue

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
        
def synthesize_video(params):
    try:
        config_path = params.get("config")
        checkpoint_path = params.get("checkpoint")
        source_image_path = params.get("source_image")
        driving_video_path = params.get("driving_video")
        result_video_path = params.get("result_video", "result.mp4")  # Default to 'result.mp4' if not provided
        window_width = params.get("window_width", 500)  
        window_height = params.get("window_height", 600)
        relative = params.get("relative", True) == True
        adapt_scale = params.get("adapt_scale", True) == True
        audio = params.get("audio",True) == True
        cpu = params.get("cpu", False) == True

        source_image = imageio.v3.imread(source_image_path)
        reader = imageio.get_reader(driving_video_path)
        fps = reader.get_meta_data()['fps']
        driving_video = []
        for frame in reader:
            driving_video.append(frame)
        reader.close()

        resized_source_image = resize(source_image, (256, 256))[..., :3]
        resized_driving_video = [resize(frame, (256, 256))[..., :3] for frame in driving_video]

        # Load checkpoints only once at the beginning of the persistent service
        load_checkpoints(config_path, checkpoint_path, cpu)
        
        predictions = make_animation(resized_source_image, resized_driving_video, relative, adapt_scale, cpu)

        imageio.mimsave(result_video_path, [img_as_ubyte(frame) for frame in predictions], fps=fps)
        
        print(f"Video saved to {result_video_path}", flush=True)

        # If audio is enabled, copy audio from the driving video to the result video
        if audio:
            try:
                temp_output_path = NamedTemporaryFile(suffix='.mp4', delete=False).name
                ffmpeg.input(result_video_path).video \
                    .output(ffmpeg.input(driving_video_path).audio, temp_output_path, vcodec='copy', acodec='aac') \
                    .overwrite_output() \
                    .run()

                # Replace the result video with the one including audio
                os.replace(temp_output_path, result_video_path)
            except ffmpeg.Error as e:
                print("Failed to copy audio.")
                print(e)

        # # Automatically play the result video
        # print(f"Playing the video: {result_video_path}")
        # if sys.platform.startswith("win"):
        #     os.startfile(result_video_path)  # Windows
        # elif sys.platform.startswith("darwin"):
        #     subprocess.run(["open", result_video_path])  # macOS
        # else:
        #     subprocess.run(["xdg-open", result_video_path])  # Linux
        display_video_with_audio(result_video_path, int(window_width), int(window_height), source_image)

    except Exception as e:
        print(f"Error: {e}")

def parse_arguments():
    parser = argparse.ArgumentParser(description="Video Animation Generation")
    parser.add_argument("--config", required=False, default="config/vox-256.yaml", help="path to config")
    parser.add_argument("--checkpoint", required=False, default="vox-cpk.pth.tar", help="path to checkpoint to restore")
    parser.add_argument("--source_image", required=False, help="path to source image")
    parser.add_argument("--driving_video", required=False, help="path to driving video")
    parser.add_argument("--result_video", default="result.mp4", help="path to output video (default: result.mp4)")
    parser.add_argument("--window_width", default=300, help="output window width")
    parser.add_argument("--window_height", default=300, help="output window height")
    parser.add_argument("--relative", default=True, action="store_true", help="use relative keypoint coordinates")
    parser.add_argument("--adapt_scale", default=True, action="store_true", help="adapt movement scale")
    parser.add_argument("--audio", default=True, action="store_true", help="copy audio to the output")
    parser.add_argument("--cpu", default=False, action="store_true", help="run on CPU")

    return parser.parse_args()

def main():
    # If the script is run directly (command line), parse arguments
    args = parse_arguments()
    params = {
        "config": args.config,
        "checkpoint": args.checkpoint,
        "source_image": args.source_image,
        "driving_video": args.driving_video,
        "result_video": args.result_video,
        "window_width": args.window_width,
        "window_height": args.window_height,
        "relative": args.relative,
        "adapt_scale": args.adapt_scale,
        "audio": args.audio,
        "cpu": args.cpu,
    }
    if args.config and args.checkpoint and args.source_image and args.driving_video:
        synthesize_video(params)
    else:
        # If the script is called by Node.js or other process, run persistently
        print("Provide parameters in the format: key1=value1|key2=value2|...")
        print("Required keys: config, checkpoint, source_image, driving_video")
        print("First Order Model Service Ready")
        while True:
            try:
                command = input().strip()
                print(command)
                if command.lower() == "exit":
                    print("Exiting service.")
                    break
                
                params = dict(item.split('=') for item in command.split('|'))
                torch.cuda.empty_cache()
                gc.collect()
                synthesize_video(params)
                torch.cuda.empty_cache()
                gc.collect()
            except KeyboardInterrupt:
                print("\nExiting service.")
                break
            except Exception as e:
                print(f"Error parsing input: {e}")
            

if __name__ == "__main__":
    main()

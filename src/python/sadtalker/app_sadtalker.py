import os
import sys
import gradio as gr
from src.gradio_demo import SadTalker
import subprocess

try:
    import webui  # in webui
    in_webui = True
except ImportError:
    in_webui = False

def toggle_audio_file(choice):
    if not choice:
        return gr.update(visible=True), gr.update(visible=False)
    return gr.update(visible=False), gr.update(visible=True)

def ref_video_fn(path_of_ref_video):
    return gr.update(value=bool(path_of_ref_video))

def sadtalker_demo(checkpoint_path='checkpoints', config_path='src/config', warpfn=None):
    sad_talker = SadTalker(checkpoint_path, config_path, lazy_load=True)

    with gr.Blocks() as sadtalker_interface:
        if not in_webui:
            gr.Markdown("""
            <div align='center'>
                <h2> 😭 SadTalker: Learning Realistic 3D Motion Coefficients for Stylized Audio-Driven Single Image Talking Face Animation (CVPR 2023) </h2>
                <a href='https://arxiv.org/abs/2211.12194'>Arxiv</a>&nbsp;&nbsp;&nbsp;
                <a href='https://sadtalker.github.io'>Homepage</a>&nbsp;&nbsp;&nbsp;
                <a href='https://github.com/Winfredy/SadTalker'>Github</a>
            </div>
            """)

        with gr.Row():
            with gr.Column():
                source_image = gr.Image(label="Source image", type="filepath")

            with gr.Column():
                driven_audio = gr.Audio(label="Input audio", type="filepath", visible=True)
                driven_audio_no = gr.Audio(label="Use IDLE mode, no audio required", visible=False)
                use_idle_mode = gr.Checkbox(label="Use Idle Animation")
                use_idle_mode.change(toggle_audio_file, inputs=use_idle_mode, outputs=[driven_audio, driven_audio_no])

                ref_video = gr.Video(label="Reference Video")
                use_ref_video = gr.Checkbox(label="Use Reference Video")
                ref_info = gr.Radio(['pose', 'blink', 'pose+blink', 'all'], value='pose', label='Reference Video')
                ref_video.change(ref_video_fn, inputs=ref_video, outputs=[use_ref_video])

        with gr.Row():
            pose_style = gr.Slider(minimum=0, maximum=45, step=1, label="Pose style", value=0)
            exp_weight = gr.Slider(minimum=0, maximum=3, step=0.1, label="Expression scale", value=1)
            blink_every = gr.Checkbox(label="Use eye blink", value=True)
            preprocess_type = gr.Radio(['crop', 'resize', 'full', 'extcrop', 'extfull'], value='crop', label='Preprocess Type')

        with gr.Row():
            is_still_mode = gr.Checkbox(label="Still Mode", value=False)
            enhancer = gr.Checkbox(label="Enhance Quality", value=False)
            batch_size = gr.Slider(minimum=1, maximum=16, step=1, label="Batch Size", value=16)
            size_of_image = gr.Slider(minimum=256, maximum=1024, step=64, label="Image Size", value=256)
            length_of_audio = gr.Slider(minimum=1, maximum=300, step=1, label="Audio Length (seconds)", value=10)
            facerender = gr.Radio(['pirender', 'facevid2vid', '3D'], value='pirender', label='Face Render')

        submit = gr.Button("Generate")
        gen_video = gr.Video(label="Generated video", format="mp4")

        submit.click(
            fn=sad_talker.test,
            inputs=[source_image, driven_audio, preprocess_type, is_still_mode, enhancer, batch_size, size_of_image, pose_style, facerender, exp_weight, use_ref_video, ref_video, ref_info, use_idle_mode, length_of_audio, blink_every],
            outputs=[gen_video]
        )

    return sadtalker_interface

if __name__ == "__main__":
    try:
        demo = sadtalker_demo()
        demo.queue()
        demo.launch()
    except Exception as e:
        print(f"Error during SadTalker initialization or launch: {e}", file=sys.stderr)

# # Dynamically construct input and output file paths based on the generated video
# input_file_path = './results/2a772510-7d00-48d2-9cda-6518790d0236/niney##idlemode_10.mp4'
# output_file_path = input_file_path.replace('.mp4', '_processed.mp4')

# # Run FFmpeg command asynchronously
# ffmpeg_command = ["ffmpeg", "-y", "-i", input_file_path, output_file_path]
# try:
#     subprocess.run(ffmpeg_command, check=True)
# except subprocess.CalledProcessError as e:
#     print(f"Error during FFmpeg processing: {e}", file=sys.stderr)



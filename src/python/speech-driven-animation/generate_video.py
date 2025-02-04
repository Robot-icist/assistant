import sda
import sys
import os
import cv2
import wave
import numpy as np
import time
import pyaudio
import threading
import torch
import gc
import warnings
warnings.filterwarnings("ignore")

torch.cuda.set_per_process_memory_fraction(0.6, device=0)

va = sda.VideoAnimator(model_path="grid")  # Instantiate the animator
# va = sda.VideoAnimator(gpu=0, model_path="timit")  # Instantiate the animator

# Function to generate video from image and audio
def generate_video(image_path, audio_path, output_video_path, window_width, window_height, play):
    try:
        print(f"Generating video from image: {image_path} and audio: {audio_path}")
        
        # Generate the video and audio
        vid, aud = va(image_path, audio_path)
        
        # Save the generated video and audio to the output path
        va.save_video(vid, aud, output_video_path)
        print(f"Video successfully saved to {output_video_path}", flush=True)   

        if play:
            # Optionally, display the video with audio
            display_video_with_audio(output_video_path, audio_path, window_width, window_height)
        else:
            print("Video playback skipped.") 
    except Exception as e:
        print(f"Error during video generation: {e}", file=sys.stderr, flush=True)

# Function to display video with audio (using OpenCV)
def display_video_with_audio(video_file, audio_file, window_width=None, window_height=None):
    cap = cv2.VideoCapture(video_file)
    if not cap.isOpened():
        print(f"Error: Unable to open video file {video_file}", file=sys.stderr)
        return

    # Get the frame rate of the video to maintain original playback speed
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0:
        print("Error: Could not retrieve video frame rate", file=sys.stderr)
        return

    print(f"Video Frame Rate: {fps} FPS")

    # Get the original video frame width and height
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Calculate aspect ratio
    aspect_ratio = frame_width / frame_height

    # If window size is provided, calculate new dimensions keeping aspect ratio
    if window_width and window_height:
        # Scale based on user-defined window size while keeping aspect ratio
        new_width = window_width
        new_height = int(new_width / aspect_ratio)
        if new_height > window_height:
            new_height = window_height
            new_width = int(new_height * aspect_ratio)
    else:
        # Use original video size if no window size is specified
        new_width = frame_width
        new_height = frame_height
    
    window_name = "Generated Video"

    # Create a window to display the video
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    # Resize the window based on new dimensions
    cv2.resizeWindow(window_name, new_width, new_height)

    # Start the audio in a separate thread so it plays in parallel with the video
    audio_thread = threading.Thread(target=play_audio, args=(audio_file,))
    audio_thread.start()

    # print("Press 'q' to quit video display.")

    # Display the video frames
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Display the video frame
        cv2.imshow(window_name, frame)

        cv2.setWindowProperty(window_name, cv2.WND_PROP_TOPMOST, 1)

        # # These two lines will force your "Main View" window to be on top with focus.
        # cv2.setWindowProperty(window_name,cv2.WND_PROP_FULLSCREEN,cv2.WINDOW_FULLSCREEN)
        # cv2.setWindowProperty(window_name,cv2.WND_PROP_FULLSCREEN,cv2.WINDOW_NORMAL)

        # Wait for key press and check if 'q' is pressed to quit
        if cv2.waitKey(int(750 / fps)) & 0xFF == ord('q'):  # Use the FPS to control playback speed
            break

    cap.release()
    cv2.destroyAllWindows()


# Function to play audio using pyaudio
def play_audio(audio_path):
    try:
        # Open the audio file
        wf = wave.open(audio_path, 'rb')

        # Initialize pyaudio
        p = pyaudio.PyAudio()

        # Open the audio stream
        stream = p.open(format=p.get_format_from_width(wf.getsampwidth()),
                        channels=wf.getnchannels(),
                        rate=wf.getframerate(),
                        output=True)

        # Read and play audio in chunks
        chunk = 1024
        data = wf.readframes(chunk)
        while data:
            stream.write(data)
            data = wf.readframes(chunk)

        # Close the stream
        stream.stop_stream()
        stream.close()
        p.terminate()

    except Exception as e:
        print(f"Error while playing audio: {e}", file=sys.stderr)

# Function to process input command
def process_input(input_str):
    try:
        # Expecting input in format: image_path|audio_path|output_video_path|window_width|window_height
        input_parts = input_str.strip().split('|')
        
        if len(input_parts) < 3:
            print(f"Error: Invalid input format. Expected 'image_path|audio_path|output_video_path|window_width|window_height|play'.", file=sys.stderr)
            return
        
        image_path, audio_path, output_video_path = input_parts[:3]

        # Optional: window size
        window_width = int(input_parts[3]) if len(input_parts) > 3 else None
        window_height = int(input_parts[4]) if len(input_parts) > 4 else None

        play = input_parts[5].lower() == "true" if len(input_parts) > 5 else True

        # Ensure the file paths are valid
        if not os.path.exists(image_path):
            print(f"Error: Image file not found at {image_path}", file=sys.stderr)
            return
        if not os.path.exists(audio_path):
            print(f"Error: Audio file not found at {audio_path}", file=sys.stderr)
            return

        # Call function to generate video
        generate_video(image_path, audio_path, output_video_path, window_width, window_height, play)

    except ValueError:
        print(f"Error: Invalid input format. Expected 'image_path|audio_path|output_video_path|window_width|window_height'.", file=sys.stderr)
    except Exception as e:
        print(f"Error while processing input: {e}", file=sys.stderr)

# Main listener function that processes input from stdin
def listen_for_requests():
    print("Python script is ready to process requests.")  # Notify the Node.js script that it's ready
    print("Provide parameters in the format: 'image_path|audio_path|output_video_path|window_width|window_height' ")
    print("Example: C:/Projects/assistant/src/python/speech-driven-animation/example/image.bmp|C:/Projects/assistant/src/python/output_fr.wav|C:/Projects/assistant/src/python/speech-driven-animation/generated.mp4|300|300 ")
    while True:
        try:
            # Read the line of input from stdin
            # input_str = sys.stdin.readline().strip()
            # input_str = sys.stdin.read().strip()
            input_str = input().strip()
            print(input_str)

            torch.cuda.empty_cache()
            gc.collect()
            if input_str:
                process_input(input_str)
            else:
                print("Received empty input, waiting for next request.")
            torch.cuda.empty_cache()
            gc.collect()
            
        except Exception as e:
            print(f"Error in request processing: {e}", file=sys.stderr)

if __name__ == "__main__":
    listen_for_requests()

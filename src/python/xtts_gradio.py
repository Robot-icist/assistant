import websockets
import gradio as gr
import torch
from TTS.api import TTS
import os
import sys
import gc
import warnings
import io
import tempfile

import time
import torchaudio
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

import numpy as np
import asyncio
import json # if you send json

import threading

client = None

previous_audio_path = None
gpt_cond_latent = None 
speaker_embedding = None

# Set UTF-8 encoding for standard input and output (good practice, though less critical for Gradio)
if os.name != 'nt': # Not strictly necessary on Windows for Gradio, but good for general Python scripts
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

warnings.filterwarnings("ignore")

# --- Global Model Initialization ---
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}", flush=True)

# if device == "cuda":
#     print("Setting CUDA memory fraction...")
#     try:
#         # Attempt to set memory fraction, might fail if CUDA context already initialized elsewhere
#         torch.cuda.set_per_process_memory_fraction(0.8, device=0) # Adjusted fraction
#     except RuntimeError as e:
#         print(f"Could not set CUDA memory fraction (may be already initialized): {e}")


print("Loading TTS model (this may take a while)...")
try:
    # # Using XTTSv2 as it's multilingual and good for voice cloning
    # tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=True).to(device)

    #  print("Loading model...", flush=True)
    config = XttsConfig()
    config.load_json("C:/Users/Gille/AppData/Local/tts/tts_models--multilingual--multi-dataset--xtts_v2/config.json")
    tts_model = Xtts.init_from_config(config)
    tts_model.load_checkpoint(config, checkpoint_dir="C:/Users/Gille/AppData/Local/tts/tts_models--multilingual--multi-dataset--xtts_v2/", use_deepspeed=False)
    tts_model.cuda()

    print("TTS model loaded successfully!", flush=True)
except Exception as e:
    print(f"Error loading TTS model: {e}")
    print("Please ensure you have the model files downloaded or a working internet connection for automatic download.")
    print("You might need to run `tts --list_models` and `tts --model_name \"tts_models/multilingual/multi-dataset/xtts_v2\" --progress_bar True` once from your terminal to download the model.")
    sys.exit(1)


# XTTSv2 supported languages (from official CoquiTTS docs/examples)
# You can update this list if you know more are well-supported by your specific XTTSv2 checkpoint
XTTS_LANGUAGES = {
    "English": "en",
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Italian": "it",
    "Portuguese": "pt",
    "Polish": "pl",
    "Turkish": "tr",
    "Russian": "ru",
    "Dutch": "nl",
    "Czech": "cs",
    "Arabic": "ar",
    "Chinese (Simplified)": "zh-cn",
    "Japanese": "ja",
    "Hungarian": "hu",
    "Korean": "ko",
    "Hindi": "hi" # Added Hindi as per common XTTS support
}
LANGUAGE_CHOICES = list(XTTS_LANGUAGES.values())

# Global configurations
CHUNK_UPLOAD_FREQUENCY = 1  # Initial frequency for sending chunks

# Add a global variable to track the last synthesis time
last_synthesis_time = time.time()

# Function to reset the chunk upload frequency
def reset_chunk_upload_frequency():
    global CHUNK_UPLOAD_FREQUENCY
    CHUNK_UPLOAD_FREQUENCY = 1

# Function to step up the chunk upload frequency
def step_up_chunk_upload_frequency():
    global CHUNK_UPLOAD_FREQUENCY
    CHUNK_UPLOAD_FREQUENCY = CHUNK_UPLOAD_FREQUENCY * 3

def concatenate_chunks(chunks_list):
    # Concatenate chunks and convert to audio data
    concatenated = torch.cat(chunks_list, dim=0)
    buffer = io.BytesIO()
    torchaudio.save(buffer, concatenated.squeeze().unsqueeze(0).cpu(), 24000, format="wav", encoding="PCM_S", bits_per_sample=16)
    return buffer.getvalue()  # Return the raw bytes of the concatenated audio

# Function to reset chunk upload frequency after inactivity
def reset_frequency_after_inactivity(seconds=5):
    global last_synthesis_time, CHUNK_UPLOAD_FREQUENCY
    if time.time() - last_synthesis_time > seconds:  # Reset after 5 seconds of inactivity
        reset_chunk_upload_frequency()

def synthesize(text_input, speaker_wav_path, language_name, triggered_from_frontend=False):
    print("CHUNK_UPLOAD_FREQUENCY", flush=True)
    print(CHUNK_UPLOAD_FREQUENCY, flush=True)
    global last_synthesis_time

    # Update the last synthesis time
    last_synthesis_time = time.time()

    if not text_input:
        return None, "Error: Text input is empty."
    if not speaker_wav_path:
        return None, "Error: Speaker WAV file not provided."
    if not os.path.exists(speaker_wav_path):
        return None, f"Error: Speaker WAV file not found at {speaker_wav_path}."
    if not language_name:
        return None, "Error: Language not selected."

    # # Reset chunk upload frequency for a new request
    # reset_chunk_upload_frequency()

    # language_code = XTTS_LANGUAGES.get(language_name)
    language_code = language_name
    if not language_code:
        return None, f"Error: Invalid language selected: {language_name}."

    status_message = ""
    output_audio_path = None

    global gpt_cond_latent, speaker_embedding, previous_audio_path 

    if(previous_audio_path is None or speaker_wav_path != previous_audio_path):
        print("Computing speaker latents...", flush=True)
        previous_audio_path = speaker_wav_path
        gpt_cond_latent, speaker_embedding = tts_model.get_conditioning_latents(audio_path=[speaker_wav_path])

    # print("Inference...", flush=True)

    try:
        # Create a temporary file for the output, Gradio will handle serving it
        # Ensure the suffix is .wav as TTS library expects it
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav_file:
            output_file_path = tmp_wav_file.name

        print(f"Synthesizing: Text='{text_input[:50]}...', Speaker WAV='{speaker_wav_path}', Lang='{language_code}'", flush=True)

        # if device == "cuda":
        #     torch.cuda.empty_cache()
        # gc.collect()

        # tts_model.tts_to_file(
        #     text=text_input,
        #     speaker_wav=speaker_wav_path,
        #     language=language_code,
        #     file_path=output_file_path, 
        # )

        t0 = time.time()
        chunks = tts_model.inference_stream(
            text_input,
            language_code,
            gpt_cond_latent,
            speaker_embedding
        )

        wav_chunks = []
        chunks_to_send = []
        for i, chunk in enumerate(chunks):
            if i == 0:
                print(f"Time to first chunck: {time.time() - t0}", flush=True)
                # # Send first chunk immediately
                # wav_data = concatenate_chunks([chunk])
                # asyncio.run(async_logic(wav_data))
                chunks_to_send = []  # Reset accumulator
                chunks_to_send.append(chunk) 
            else:
                chunks_to_send.append(chunk)
                # Send accumulated chunks every CHUNK_UPLOAD_FREQUENCY iterations after the first chunk
                if (i + 1) % CHUNK_UPLOAD_FREQUENCY == 0 and chunks_to_send:
                    wav_data = concatenate_chunks(chunks_to_send)
                    asyncio.run(async_logic(wav_data))
                    chunks_to_send = []  # Reset accumulator after sending
                    step_up_chunk_upload_frequency()  # Step up the frequency

            print(f"Received chunk {i} of audio length {chunk.shape[-1]}", flush=True)
            wav_chunks.append(chunk)

        # Send any remaining chunks
        if chunks_to_send:
            wav_data = concatenate_chunks(chunks_to_send)
            asyncio.run(async_logic(wav_data))

        # #send complete audio directly by websocket
        # wav_data = concatenate_chunks(wav_chunks)
        # asyncio.run(async_logic(wav_data))

        if triggered_from_frontend:
            print("Saving audio to file as triggered from frontend...", flush=True)
            # Save to file needed for video generation / Gradio playback
            wav = torch.cat(wav_chunks, dim=0)
            torchaudio.save(output_file_path, wav.squeeze().unsqueeze(0).cpu(), 24000, encoding="PCM_S", bits_per_sample=16)
            output_audio_path = output_file_path
            status_message = f"Audio generated successfully! Saved to temporary path: {output_audio_path}"
            print(status_message, flush=True)

    except Exception as e:
        error_msg = f"Error during TTS synthesis: {e}"
        print(error_msg, flush=True)
        status_message = error_msg
        if output_audio_path and os.path.exists(output_audio_path):
            os.remove(output_audio_path) # Clean up temp file if error occurred after creation
        output_audio_path = None
    # finally:
    #     if device == "cuda":
    #         torch.cuda.empty_cache()
    #     gc.collect()

    return output_audio_path, status_message

# gr.themes.Base() - the "base" theme sets the primary color to blue but otherwise has minimal styling, making it particularly useful as a base for creating new, custom themes.
# gr.themes.Default() - the "default" Gradio 5 theme, with a vibrant orange primary color and gray secondary color.
# gr.themes.Origin() - the "origin" theme is most similar to Gradio 4 styling. Colors, especially in light mode, are more subdued than the Gradio 5 default theme.
# gr.themes.Citrus() - the "citrus" theme uses a yellow primary color, highlights form elements that are in focus, and includes fun 3D effects when buttons are clicked.
# gr.themes.Monochrome() - the "monochrome" theme uses a black primary and white secondary color, and uses serif-style fonts, giving the appearance of a black-and-white newspaper.
# gr.themes.Soft() - the "soft" theme uses a purple primary color and white secondary color. It also increases the border radius around buttons and form elements and highlights labels.
# gr.themes.Glass() - the "glass" theme has a blue primary color and a transclucent gray secondary color. The theme also uses vertical gradients to create a glassy effect.
# gr.themes.Ocean() - the "ocean" theme has a blue-green primary color and gray secondary color. The theme also uses horizontal gradients, especially for buttons and some form elements.

# --- Gradio Interface Definition ---
with gr.Blocks(theme=gr.themes.Default()) as app:
    # gr.Markdown("# 🐸 Coqui TTS XTTSv2 Gradio Interface")
    gr.Markdown("# XTTSv2 Gradio Interface")
    gr.Markdown(
        "Enter text, upload a reference speaker WAV file (clear audio, 5-30 seconds long is ideal, mono 16-bit 22050Hz or 24000Hz recommended), "
        "and select the language of the text."
    )
    
    with gr.Row():
        with gr.Column(scale=2):
            text_input = gr.Textbox(
                label="Text to Synthesize",
                placeholder="Type or paste your text here...",
                lines=4
            )
            speaker_wav_input = gr.Audio(
                label="Speaker Reference WAV",
                type="filepath", # Important: TTS library needs a file path
                # file_types=[".wav"] # This doesn't seem to work reliably for gr.Audio, user needs to ensure it's WAV
            )
            language_dropdown = gr.Dropdown(
                label="Language of Text",
                choices=LANGUAGE_CHOICES,
                value="en" # Default language
            )
            from_frontend = gr.Checkbox(
                label="Triggered From Frontend",
                value=True, # Default value
                visible=False, # Hidden input to indicate if triggered from frontend
            )
            submit_button = gr.Button("Synthesize Audio", variant="primary")
        
        with gr.Column(scale=1):
            audio_output = gr.Audio(
                label="Synthesized Audio Output",
                type="filepath" # To play/download the generated file
            )
            status_output = gr.Textbox(
                label="Status / Log",
                lines=5,
                interactive=False # Read-only
            )

    submit_button.click(
        fn=synthesize,
        inputs=[text_input, speaker_wav_input, language_dropdown, from_frontend],
        outputs=[audio_output, status_output]
    )
    
    gr.Examples(
        examples=[
            ["Hello, this is a test of the text to speech system.", "wavs/scarlett.wav", "en"],
            ["Bonjour, ceci est un test du système de synthèse vocale.", "wavs/pierrenineytrim.wav", "fr"],
            ["Hola, esta es una prueba del sistema de texto a voz.", "wavs/scarlett.wav", "es"],
        ],
        inputs=[text_input, speaker_wav_input, language_dropdown, from_frontend],
        outputs=[audio_output, status_output],
        fn=synthesize,
        cache_examples=False # Set to True if you want to pre-compute and cache example outputs
    )
    # # Add a note about example WAV files
    # gr.Markdown(
    #     "Note: For the examples to work, you'll need to create an `wavs` folder in the same directory "
    #     "as this script and place `female_voice_sample.wav` and `male_voice_sample.wav` (or your own samples) in it."
    # )


async def async_logic(data) :
    global client 
    client = await websockets.connect("ws://localhost:80")
    if(data is not None):
        await client.send(data)

# Define a proper function for periodic reset
def periodic_reset():
    while True:
        time.sleep(5)
        reset_frequency_after_inactivity(5)

# Start the thread with the periodic reset function
threading.Thread(target=periodic_reset, daemon=True).start()

if __name__ == "__main__":
    print("Launching Gradio app...", flush=True)
    asyncio.run(async_logic(None))
    # You can share the app by setting share=True (requires internet)
    # app.launch(share=True) 
    app.launch()
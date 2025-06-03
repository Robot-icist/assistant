import torch
from TTS.api import TTS
import argparse
import os
import simpleaudio as sa
import sys
import gc
import warnings
import torchaudio
import io

# Set UTF-8 encoding for standard input and output
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


# from TTS.tts.configs.xtts_config import XttsConfig
# from TTS.tts.models.xtts import Xtts

# print("Loading model...")
# config = XttsConfig()
# config.load_json("/path/to/xtts/config.json")
# model = Xtts.init_from_config(config)
# model.load_checkpoint(config, checkpoint_dir="/path/to/xtts/", use_deepspeed=True)
# model.cuda()

# print("Computing speaker latents...")
# gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=["reference.wav"])

# def infere_tts():
# print("Inference...")
# out = model.inference(
#     "It took me quite a long time to develop a voice and now that I have it I am not going to be silent.",
#     "en",
#     gpt_cond_latent,
#     speaker_embedding,
#     temperature=0.7, # Add custom parameters here
# )
# torchaudio.save("xtts.wav", torch.tensor(out["wav"]).unsqueeze(0), 24000)

warnings.filterwarnings("ignore")

torch.cuda.set_per_process_memory_fraction(0.6, device=0)

# Initialize the model only once
device = "cuda" if torch.cuda.is_available() else "cpu"
print('Device :')
print(device)

# # List available 🐸TTS models
# tts_manager = TTS().list_models()
# all_models = tts_manager.list_models()
# print(all_models)

print("Loading TTS model...")
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=True).to(device)
# tts = TTS("tts_models/multilingual/multi-dataset/your_tts").to(device)
# tts = TTS(model_name="tts_models/fr/mai/tacotron2-DDC").to(device) 
# tts = TTS(model_name="tts_models/fr/css10/vits").to(device) 
# tts = TTS("xtts", progress_bar=False).to(device)
print("Model loaded successfully!")

def synthesize_tts(text, speaker_wav, language, output_file, play_audio=False):
    try:
        # Generate the audio file
        print(f"Generating speech for text: {text}", flush=True)
        tts.tts_to_file(text=text, speaker_wav=speaker_wav, language=language, file_path=output_file)
        print(f"Audio generated and saved to {output_file}", flush=True)

        # Play the audio file if the play_audio flag is True
        if play_audio and os.path.exists(output_file):
            print("Playing the audio...", flush=True)
            wave_obj = sa.WaveObject.from_wave_file(output_file)
            play_obj = wave_obj.play()
            play_obj.wait_done()  # Wait until audio finishes playing
            print("Audio played", flush=True)
        elif not play_audio:
            print("Audio playback skipped.", flush=True)
        else:
            print(f"Output file {output_file} does not exist.", flush=True)
    except Exception as e:
        print(f"Error: {e}", flush=True)

def main():
    parser = argparse.ArgumentParser(description="Persistent TTS Service")
    parser.add_argument("--text", type=str, required=False, help="Text to synthesize")
    parser.add_argument("--speaker_wav", type=str, required=False, help="Path to the speaker WAV file for cloning")
    parser.add_argument("--language", type=str, required=False, help="Language code (e.g., 'en', 'fr')")
    parser.add_argument("--output_file", type=str, required=False, help="Path to save the output WAV file")
    parser.add_argument("--play_audio", type=bool, default=False, help="Whether to play the audio after generation (default: False)")
    args = parser.parse_args()

    if args.text and args.speaker_wav and args.language and args.output_file:
        # Run once if arguments are passed directly
        synthesize_tts(args.text, args.speaker_wav, args.language, args.output_file, args.play_audio)
    else:
        print("Persistent mode active. Waiting for input...")
        print("Provide parameters in the format: text=<text>|speaker_wav=<path>|language=<lang>|output_file=<path>|play_audio=<True/False>")
        print("Example: text=Hello world|speaker_wav=C:/Projects/assistant/src/python/wavs/weapon.wav|language=en|output_file=output.wav|play_audio=True")
        print("Example: text=Salut je suis la voix française de robert downey junior|speaker_wav=C:/Projects/assistant/src/python/wavs/bernardgabaytrim30.wav|language=fr|output_file=output.wav|play_audio=True")
        print("TTS Service Ready")
        while True:
            try:
                command = input().strip()
                # command = sys.stdin.readline().strip()
                # command = sys.stdin.read().strip()
                if command.lower() == "exit":
                    print("Exiting TTS service.")
                    break
                print(command)
                # Parse command
                params = dict(item.split('=') for item in command.split('|'))
                print(params)
                text = params.get("text")
                speaker_wav = params.get("speaker_wav")
                language = params.get("language")
                output_file = params.get("output_file")
                play_audio = params.get("play_audio", "true").lower() == "true"

                torch.cuda.empty_cache()
                gc.collect()

                if text and speaker_wav and language and output_file:
                    synthesize_tts(text, speaker_wav, language, output_file, play_audio)
                else:
                    print("Invalid parameters. Please provide all required parameters.")

                torch.cuda.empty_cache()
                gc.collect()

            except KeyboardInterrupt:
                print("\nExiting TTS service.")
                break
            except Exception as e:
                print(f"Error parsing input: {e}")

if __name__ == "__main__":
    main()
import os
import argparse
import logging
import sys
from eff_word_net.streams import SimpleMicStream
from eff_word_net.engine import HotwordDetector
from eff_word_net.audio_processing import Resnet50_Arc_loss
from eff_word_net import samples_loc

# Set up logging to send logs to stdout (sys.stdout)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger()

def main(ref_json_path, hotword_name, threshold, relaxation_time):
    try:
        logger.info("Initializing base model")
        base_model = Resnet50_Arc_loss()

        logger.info(f"Initializing hotword detector for '{hotword_name}'")
        hotword = HotwordDetector(
            hotword=hotword_name,
            model=base_model,
            reference_file=ref_json_path,
            threshold=threshold,
            relaxation_time=relaxation_time
        )

        logger.info("Initializing microphone stream")
        mic_stream = SimpleMicStream(
            window_length_secs=1.5,
            sliding_window_secs=0.75,
        )

        logger.info("Starting microphone stream")
        mic_stream.start_stream()

        logger.info(f"Say '{hotword_name}'")
        while True:
            try:
                frame = mic_stream.getFrame()
                result = hotword.scoreFrame(frame)

                if result is None:
                    # No voice activity, continue listening
                    continue

                if result["match"]:
                    logger.info(f"Wakeword Detected with confidence: {result['confidence']}")

            except Exception as e:
                # Log the error to stdout and continue processing
                logger.warning(f"Error processing microphone frame: {e}")

    except Exception as e:
        # Log any top-level errors to stdout
        logger.error(f"An error occurred: {e}")

if __name__ == "__main__":
    # Set default values
    default_ref_json_path = "C:/Projects/assistant/src/python/hotwords/gilles/gilles_ref.json"
    default_hotword_name = "gilles"
    default_threshold = 0.7
    default_relaxation_time = 0.8

    parser = argparse.ArgumentParser(description="Wakeword detection script")
    parser.add_argument(
        "--ref-json-path", type=str, default=default_ref_json_path, help="Path to the reference JSON file for the hotword (default: %(default)s)"
    )
    parser.add_argument(
        "--hotword-name", type=str, default=default_hotword_name, help="The name of the wakeword to detect (default: %(default)s)"
    )
    parser.add_argument(
        "--threshold", type=float, default=default_threshold, help="Threshold for hotword detection (default: %(default)s)"
    )
    parser.add_argument(
        "--relaxation-time", type=float, default=default_relaxation_time, help="Relaxation time for hotword detection (default: %(default)s)"
    )

    args = parser.parse_args()

    # Call main with the provided or default arguments
    main(args.ref_json_path, args.hotword_name, args.threshold, args.relaxation_time)

import vosk from "vosk";
import fs from "fs";
import { mic } from "./lib/mic.js";
import path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import { randomInt } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the name of the directory

const MODEL_PATH = path.resolve(
  __dirname,
  `models/${
    process.env.LANG == "fr"
      ? "vosk-model-small-fr-0.22"
      : "vosk-model-small-en-us-0.15"
  }`
);

const SAMPLE_RATE = 16000;

// Ensure model exists
if (!fs.existsSync(MODEL_PATH)) {
  console.error(
    `Please download the model from https://alphacephei.com/vosk/models and unpack as ${MODEL_PATH}`
  );
  process.exit(1);
}

// Initialize Vosk model and recognizer
vosk.setLogLevel(process.env.DEBUG ? 0 : -1);
const model = new vosk.Model(MODEL_PATH);
const recognizer = new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });

let micInstance;
let micInputStream;

/**
 * Start microphone recognition and handle transcription via callback.
 * @param {Function} cb - Callback to handle recognized text.
 */
export function startMicRecognition(cb) {
  stopMicRecognition();
  micInstance = mic({
    rate: String(SAMPLE_RATE),
    channels: "1",
    debug: true,
    device: "default",
  });

  micInputStream = micInstance.getAudioStream();

  micInputStream.on("data", async (data) => {
    if (recognizer.acceptWaveform(data)) {
      const result = recognizer.result();
      console.log(result);
      micInstance.stop();
      cb(result.text);
    } else {
      console.log(recognizer.partialResult());
    }
  });

  micInstance.start();
}

/**
 * Stop the microphone recording.
 */
export function stopMicRecognition() {
  if (micInstance && micInputStream) {
    micInputStream.end();
    micInstance.stop();
    micInputStream = null;
    micInstance = null;
    console.log("Microphone recording stopped.");
  }
}

/**
 * Cleanup resources used by the recognizer and model.
 */
export function cleanupMicRecognition() {
  stopMicRecognition();
  recognizer.free();
  model.free();
  console.log("Resources cleaned up.");
}

/**
 * Record audio and save to a file with configurable length and format.
 * @param {string} outputPath - Path to save the audio file.
 * @param {number} duration - Duration of the recording in seconds.
 * @param {string} format - File format to save (e.g., "wav" or "mp3").
 */
export function recordAudioToFile(outputPath, duration, format = "wav") {
  micInstance = mic({
    rate: String(44100),
    channels: "1",
    debug: true,
    device: "default",
  });

  const micInputStream = micInstance.getAudioStream();

  const tempFilePath = path.join(__dirname, `temp${randomInt(1000)}.raw`); // Temporary raw file
  const writeStream = fs.createWriteStream(tempFilePath);

  console.log(`Recording audio for ${duration} seconds...`);

  micInputStream.pipe(writeStream);

  micInstance.start();

  setTimeout(() => {
    if (micInstance) micInstance.stop();
    writeStream.end();

    // Convert raw audio to the desired format
    ffmpeg(tempFilePath)
      .inputOptions(["-f", "s16le", "-ar", String(44100), "-ac", "1"])
      .output(outputPath)
      .outputOptions(format === "mp3" ? ["-codec:a libmp3lame"] : [])
      .on("end", () => {
        console.log(`Audio saved to ${outputPath}`);
        fs.unlinkSync(tempFilePath); // Cleanup temporary file
      })
      .on("error", (err) => {
        console.error("Error processing audio:", err);
      })
      .run();
  }, duration * 1000);
}

export default {
  startMicRecognition,
  stopMicRecognition,
  cleanupMicRecognition,
  recordAudioToFile,
};

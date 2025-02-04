import { Worker } from "worker_threads";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

export const audioQueue = [];
let isAudioProcessing = false;
export const getIsAudioProcessing = () => isAudioProcessing;
export const setIsAudioProcessing = (val) => (isAudioProcessing = val);

// Function to play an audio file
export async function playAudio(filePath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Read and buffer the audio file
      const fileBuffer = await fs.promises.readFile(filePath);

      // Use ffmpeg to extract metadata
      const metadata = await getAudioMetadata(filePath);

      // Add the buffer and metadata to the queue
      audioQueue.push({ fileBuffer, metadata, resolve, reject });

      // If no audio is currently being processed, start processing the queue
      if (!isAudioProcessing) {
        processQueue();
      }
    } catch (error) {
      reject(`Failed to prepare audio: ${error}`);
    }
  });
}

// Helper function to extract audio metadata using ffprobe
function getAudioMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(`Error reading audio file metadata: ${err}`);
      } else {
        resolve(metadata);
      }
    });
  });
}

// Function to process the audio queue
function processQueue() {
  if (audioQueue.length === 0) {
    isAudioProcessing = false;
    return;
  }

  isAudioProcessing = true;

  const { fileBuffer, metadata, resolve, reject } = audioQueue.shift();

  // Create a new worker to handle audio playback
  const worker = new Worker(path.resolve(__dirname, "audio-worker.js"), {
    env: {
      PATH: process.env.PATH, // Pass the PATH to the worker thread mandatory to get access to ffmpeg
    },
  });

  // Send the file buffer and metadata to the worker
  worker.postMessage({ fileBuffer, metadata });

  // Handle messages from the worker (success or error)
  worker.on("message", (message) => {
    if (message.status === "success") {
      resolve();
    } else {
      reject(message.error);
    }

    // Continue processing the next audio in the queue
    processQueue();
  });

  // Handle worker errors
  worker.on("error", (error) => {
    console.error("Worker thread error:", error);
    reject(error);
    processQueue();
  });
}

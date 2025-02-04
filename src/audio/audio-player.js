import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import Speaker from "speaker";

// A queue to handle audio files
const audioQueue = [];
let isPlaying = false; // To track whether any audio is currently being played

// Function to play an audio file
export async function playAudio(filePath) {
  return new Promise((resolve, reject) => {
    // Add the filePath to the queue, with its resolve/reject handlers
    audioQueue.push({ filePath, resolve, reject });

    // If no audio is currently playing, start processing the queue asynchronously
    if (!isPlaying) {
      processQueue(); // Start the queue processing
    }
  });
}

// Function to process the audio queue
function processQueue() {
  // If the queue is empty, stop playing
  if (audioQueue.length === 0) {
    isPlaying = false; // Mark playback as stopped
    return;
  }

  isPlaying = true; // Mark that we are currently playing audio

  // Get the next audio command from the queue
  const { filePath, resolve, reject } = audioQueue.shift();

  // Offload metadata extraction to a new async function to avoid blocking
  extractMetadata(filePath)
    .then((metadata) => {
      const { channels, sample_rate, bit_depth } = metadata.streams[0];

      // Create a new Speaker instance using the audio file's specifications
      const speaker = new Speaker({
        channels, // Number of channels (Stereo/Mono)
        bitDepth: bit_depth || 16, // Bit depth (16-bit if not available)
        sampleRate: sample_rate, // Sample rate (e.g., 44100Hz)
      });

      // Now, create a stream to read the audio file and decode it
      const fileStream = fs.createReadStream(filePath);

      // Use ffmpeg to decode the audio file and pipe the output to the speaker
      const command = ffmpeg()
        .input(fileStream) // Provide the file stream directly to ffmpeg
        .audioCodec("pcm_s16le") // Ensure that we are using PCM audio (16-bit)
        .format("wav") // Ensure the format is compatible with Speaker (WAV is fine for raw PCM)
        .on("error", (err) => {
          console.error("Error processing audio:", err);
          processQueue(); // Continue processing the queue even if there's an error
          reject(err); // Reject the current promise on error
        })
        .on("end", () => {
          setImmediate(() => processQueue()); // Continue processing the queue after the current sound
          resolve(); // Resolve the promise when the audio finishes
        });

      // Pipe the output to the speaker (raw audio stream)
      command.pipe(speaker, { end: true });
    })
    .catch((err) => {
      console.error("Error extracting metadata:", err);
      reject(err); // Reject the promise on metadata extraction failure
      setImmediate(() => processQueue()); // Continue processing the queue even if there's an error
    });
}

// Helper function to extract metadata asynchronously
function extractMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(err); // Reject if there is an error fetching metadata
      }
      resolve(metadata); // Resolve the metadata
    });
  });
}

// Example usage
// playAudio('path/to/your/audio/file1.mp3').then(() => console.log("Audio 1 finished"));
// playAudio('path/to/your/audio/file2.mp3').then(() => console.log("Audio 2 finished"));

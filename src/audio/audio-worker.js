import ffmpeg from "fluent-ffmpeg";
import Speaker from "speaker";
import { parentPort } from "worker_threads";
import { Readable } from "stream";

// Function to process the audio buffer
function processAudio(fileBuffer, metadata) {
  return new Promise((resolve, reject) => {
    const { channels, sample_rate, bit_depth } = metadata.streams[0];

    // Create a Speaker instance using the audio file's specifications
    const speaker = new Speaker({
      channels, // Number of channels (Stereo/Mono)
      bitDepth: bit_depth || 16, // Bit depth (16-bit if not available)
      sampleRate: sample_rate, // Sample rate (e.g., 44100Hz)
    });

    // Create a readable stream from the file buffer
    const fileStream = new Readable();
    fileStream.push(fileBuffer);
    fileStream.push(null); // Signal the end of the stream

    // Use ffmpeg to decode the audio and pipe it to the speaker
    const command = ffmpeg()
      .input(fileStream) // Provide the file buffer as a stream
      .audioCodec("pcm_s16le") // Use PCM audio (16-bit)
      .format("wav") // Format compatible with Speaker
      .on("error", (err) => {
        reject(`Error processing audio: ${err}`);
      });

    // Handle playback end
    speaker.on("close", () => {
      resolve();
    });

    // Pipe the decoded audio to the speaker
    command.pipe(speaker, { end: true });
  });
}

// Listen for messages from the main thread
parentPort.on("message", async ({ fileBuffer, metadata }) => {
  try {
    await processAudio(fileBuffer, metadata);
    parentPort.postMessage({ status: "success" });
  } catch (error) {
    parentPort.postMessage({ status: "error", error });
  }
});

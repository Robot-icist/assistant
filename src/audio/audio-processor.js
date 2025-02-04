import ffmpeg from "fluent-ffmpeg";
import { dirname, extname, basename, join } from "path";
import { existsSync } from "fs";

/**
 * Processes the audio file.
 * Converts it to WAV, trims the first 15 seconds, and saves the result.
 * @param {string} inputPath - The path to the input audio file.
 */
function processAudio(inputPath) {
  if (!existsSync(inputPath)) {
    console.error("Input file does not exist:", inputPath);
    return;
  }

  // Get file details
  const inputDir = dirname(inputPath);
  const ext = extname(inputPath);
  const baseName = basename(inputPath, ext);

  // Define output path
  const outputFileName = `${baseName}-trim.wav`;
  const outputPath = join(inputDir, outputFileName);

  console.log("Processing file:", inputPath);
  console.log("Output will be saved to:", outputPath);

  // Use FFmpeg to convert and trim the file
  ffmpeg(inputPath)
    .toFormat("wav") // Convert to WAV format
    .setStartTime(0) // Start at 0 seconds
    .setDuration(15) // Take the first 15 seconds
    .on("end", () => {
      console.log("Processing complete. File saved as:", outputPath);
    })
    .on("error", (err) => {
      console.error("An error occurred:", err.message);
    })
    .save(outputPath); // Save the output file
}

// Example usage
const inputAudioPath = process.argv[2]; // Take the input path from the command line
if (!inputAudioPath) {
  console.error("Please provide an input audio file path.");
  console.error("Usage: node audio-processor.js <input-audio-path>");
} else {
  processAudio(inputAudioPath);
}

import path from "path";
import fs from "fs";
import { recordAudioToFile } from "../voice/recognition.js";
import { sleep } from "@nut-tree-fork/nut-js";
import { rl } from "./rl.js";
import { initialize, takePictureJpeg, stop } from "../image/camera.js";
import { randomInt } from "crypto";
import { runExecutableWithArgs } from "./processRunner.js";
import ffmpeg from "fluent-ffmpeg";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

// Define the base directory for samples
const baseSamplesDir = path.resolve(__dirname, "../"); // Base directory for all sample files

export const convertToH264 = async (inputPath, outputPath) => {
  return new Promise((res, rej) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec("libx264") // Set H.264 codec
      .audioCodec("aac") // Set AAC audio codec (common for MP4)
      .format("mp4") // Output format (MP4)
      .on("start", (commandLine) => {
        console.log("FFmpeg command: ", commandLine);
      })
      .on("progress", (progress) => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on("end", () => {
        console.log("Conversion finished!");
        res();
      })
      .on("error", (err) => {
        console.error("Error: ", err);
        rej();
      })
      .run();
  });
};

// Function to ask for user input
const askQuestion = (query) =>
  new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });

// Utility function to ensure the directory exists, create if not
export const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
};

export const deleteDir = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true });
    console.log(`Deleted directory: ${dir}`);
  }
};

// Function to register the face (takes sample pictures)
const registerFace = async () => {
  await initialize();
  const name = await askQuestion('Enter name for face (e.g., "John Doe"): ');
  const numSamples = parseInt(
    await askQuestion("Enter the number of sample pictures: "),
    10
  );

  // Path for storing face samples
  const faceDir = path.join(baseSamplesDir, "image", "pictures", name);

  // Ensure the directory exists
  ensureDirExists(faceDir);

  console.log(`Starting face registration for ${name}...`);

  for (let i = 0; i < numSamples; i++) {
    const fileName = path.join(faceDir, `face_sample_${i + 1}.jpg`);
    console.log(`Taking picture ${i + 1}...`);
    await takePictureJpeg(fileName); // Assume takePictureJpeg is defined elsewhere
    await sleep(2000); // Add a short delay between taking pictures
  }

  console.log(
    `Face registration completed for ${name}. Samples saved in: ${faceDir}`
  );
  await stop();
};

// Function to register the hotword (takes sample audio files)
const registerHotword = async (speak = false) => {
  const hotwordName = await askQuestion(
    'Enter the name for the hotword (e.g., "gilles"): '
  );
  const numSamples = parseInt(
    await askQuestion("Enter the number of audio samples: "),
    10
  );

  // Path for storing hotword samples
  const hotwordDir = path.join(
    baseSamplesDir,
    "voice",
    "hotwords",
    hotwordName
  );

  // Ensure the directory exists
  ensureDirExists(hotwordDir);

  console.log(`Starting hotword registration for "${hotwordName}"...`);

  for (let i = 0; i < numSamples; i++) {
    const outputPath = path.join(
      hotwordDir,
      `recorded_audio_${randomInt(1000)}.wav`
    );
    console.log(`Recording sample ${i + 1}...`);
    recordAudioToFile(outputPath, 3, "wav"); // DO not await to generate speak
    if (speak) await speak(hotwordName);
    await sleep(3000); // Add a short delay between recordings
  }

  runExecutableWithArgs(
    "python",
    [
      "-m",
      "eff_word_net.generate_reference",
      "--input-dir",
      hotwordDir,
      "--output-dir",
      hotwordDir,
      "--wakeword",
      hotwordName,
      "--model-type",
      "resnet_50_arc",
    ],
    false
  );

  console.log(
    `Hotword registration completed for "${hotwordName}". Samples saved in: ${hotwordDir}`
  );
};

// Function to register the voice clone (takes sample audio files)
const registerVoiceClone = async () => {
  const voiceName = await askQuestion(
    'Enter the name for the voice (e.g., "gilles"): '
  );
  const numSamples = parseInt(
    await askQuestion("Enter the number of audio samples: "),
    10
  );

  // Path for storing voice clone samples
  const voiceDir = path.join(baseSamplesDir, "python", "wavs", voiceName);

  // Ensure the directory exists
  ensureDirExists(voiceDir);

  console.log(`Starting voice clone registration for "${voiceName}"...`);

  for (let i = 0; i < numSamples; i++) {
    const outputPath = path.join(
      voiceDir,
      `voice_sample_${randomInt(1000)}.wav`
    );
    console.log(`Recording voice sample ${i + 1}...`);
    recordAudioToFile(outputPath, 15, "wav"); // Assume recordAudioToFile is defined elsewhere
    await sleep(15000); // Add a short delay between recordings
  }

  console.log(
    `Voice clone registration completed for "${voiceName}". Samples saved in: ${voiceDir}`
  );
};

/**
 * Creates a temporary file from a buffer asynchronously.
 * @param {Buffer} buffer - The buffer to write to the temporary file.
 * @param {string} [extension='wav'] - Optional file extension (default: 'wav').
 * @returns {Promise<Object>} - A Promise resolving to an object containing the file path and a method to delete the file.
 */
const createTempFileFromBuffer = async (buffer, extension = "wav") => {
  const tempDir = os.tmpdir(); // Get the OS temporary directory
  const fileName = `temp-${Date.now()}.${extension}`;
  const filePath = path.join(tempDir, fileName);

  // Write the buffer to the file
  await fs.promises.writeFile(filePath, buffer);

  return {
    path: filePath,
    delete: async (timeout = 60 * 1000) => {
      try {
        setTimeout(async () => await fs.promises.unlink(filePath), timeout); // Delete the file after use
        console.log(`Temporary file deleted: ${filePath}`);
      } catch (err) {
        console.error(`Failed to delete temporary file: ${filePath}`, err);
      }
    },
  };
};

export {
  registerFace,
  registerHotword,
  registerVoiceClone,
  createTempFileFromBuffer,
};

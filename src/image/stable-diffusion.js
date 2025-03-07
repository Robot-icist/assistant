import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "child_process";
import { sendToAll } from "../utils/ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stableDiffusionUrlTxt2Img = "http://localhost:8080/sdapi/v1/txt2img";
const stableDiffusionUrlImg2Img = "http://localhost:8080/sdapi/v1/img2img";

// Ensure output directory exists
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const outputFolder = path.join(__dirname, "generated");
ensureDirectoryExists(outputFolder);

// Save image buffer to a file
const saveImageToFile = (buffer, filename) => {
  const filePath = path.join(outputFolder, filename);
  fs.writeFileSync(filePath, buffer);
  console.log(`Image saved to ${filePath}`);
  return filePath;
};

// Open image in a browser using Puppeteer
const displayImageInBrowser = async (base64Image) => {
  const htmlContent = `<html>
    <body style="margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #000;">
      <img src="${base64Image}" style="max-width: 100%; max-height: 100%;" />
    </body>
  </html>`;

  const browser = await puppeteer.launch({
    headless: false,
  });
  const page = (await browser.pages())[0];
  await page.setContent(htmlContent);
  console.log("Image displayed in browser.");
  return browser; // Return browser instance for control
};

// Generate a single image using txt2img
const generateTxt2Img = async (prompt, saveToFile = false) => {
  try {
    const response = await fetch(stableDiffusionUrlTxt2Img, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: "blurry, watermark, text, copyright, logo",
        width: 512,
        height: 512,
        samples: 1,
        steps: 30,
        seed: -1,
        cfg_scale: 10,
        // restore_faces: false,
      }),
    });
    const data = await response.json();
    const base64Image = `data:image/png;base64,${data.images[0]}`;
    const buffer = Buffer.from(data.images[0], "base64");

    if (saveToFile) saveImageToFile(buffer, "generated_image.png");
    return { buffer, base64Image };
  } catch (error) {
    console.error("Error generating image (txt2img):", error.message);
  }
};

// Generate a single frame using img2img
const generateImg2Img = async (
  prompt,
  initImageBuffer,
  denoisingStrength = 0.1
) => {
  try {
    const response = await fetch(stableDiffusionUrlImg2Img, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: "blurry, watermark, text, copyright, logo",
        init_images: [
          `data:image/png;base64,${initImageBuffer.toString("base64")}`,
        ],
        width: 512,
        height: 512,
        samples: 1,
        seed: -1,
        steps: 30,
        cfg_scale: 10,
        denoising_strength: denoisingStrength,
      }),
    });
    const data = await response.json();
    return Buffer.from(data.images[0], "base64");
  } catch (error) {
    console.error("Error generating image (img2img):", error.message);
  }
};

// Generate a sequence of frames for a video
const generateVideoFrames = async (
  basePrompt,
  numFrames,
  saveToFile = false
) => {
  const frames = [];
  let previousFrameBuffer = (await generateTxt2Img(basePrompt))?.buffer;

  if (saveToFile) saveImageToFile(previousFrameBuffer, "frame_001.png");
  frames.push(previousFrameBuffer);

  for (let i = 1; i < numFrames; i++) {
    const modifiedPrompt = `${basePrompt}, slight random movement of the scene camera paning to the right, but keeping same aspect and realness frame ${
      i + 1
    }`;
    const frameBuffer = await generateImg2Img(
      modifiedPrompt,
      previousFrameBuffer,
      0.1
      // 0.5
    );

    if (saveToFile) {
      saveImageToFile(
        frameBuffer,
        `frame_${String(i + 1).padStart(3, "0")}.png`
      );
    }
    frames.push(frameBuffer);
    previousFrameBuffer = frameBuffer;
  }

  return frames;
};

// Function to start a video player in the native system
async function startVideo(url) {
  try {
    const childProcess = spawn("cmd.exe", ["start", url]);
    console.log("Playing video...");
    return new Promise((resolve) => setTimeout(() => resolve(), 1000)); // Wait for 1 second
  } catch (error) {
    console.error(error);
    return null;
  }
}

// Create a video from frames
const createVideoFromFrames = (fps, deleteFramesAfter = true) => {
  const videoOutputPath = path.join(outputFolder, "generated_video.mp4");

  ffmpeg()
    .input(path.join(outputFolder, "frame_%03d.png")) // Input numbered frames
    .inputOptions("-framerate", fps.toString())
    .outputOptions("-pix_fmt", "yuv420p")
    .output(videoOutputPath)
    .on("end", () => {
      console.log(`Video created at ${videoOutputPath}`);
      fs.readFile(videoOutputPath, (err, data) => {
        if (err) {
          console.error("\nError reading the MP4 file:", err);
          return;
        }
        console.log("\nSending MP4 file...");
        // Send the WAV file as binary data
        sendToAll(data, true);
      });
      if (deleteFramesAfter) {
        // Delete frames
        fs.readdir(outputFolder, (err, files) => {
          if (err) console.error("Error reading frames directory:", err);
          else {
            files.forEach((file) => {
              if (file.startsWith("frame_") && file.endsWith(".png")) {
                fs.unlinkSync(path.join(outputFolder, file));
              }
            });
            console.log("Frames deleted.");
          }
        });
      }
      startVideo(videoOutputPath);
    })
    .on("error", (err) => console.error("Error creating video:", err.message))
    .run();
};

// Export functions for modular usage
export const generateImage = async (
  prompt,
  displayInBrowser = false,
  saveToFile = false
) => {
  const { buffer, base64Image } = await generateTxt2Img(prompt, saveToFile);
  if (displayInBrowser) {
    const browser = await displayImageInBrowser(base64Image);
    return { buffer, browser }; // Return browser instance to close it later
  }
  return buffer;
};

export const generateVideo = async (
  basePrompt,
  fps,
  lengthInSeconds,
  saveframes = true
) => {
  const frames = await generateVideoFrames(
    basePrompt,
    fps * lengthInSeconds,
    saveframes
  );
  createVideoFromFrames(fps);
};

// // Example usage:
// (async () => {
//   const prompt =
//     "A surreal forest with glowing mushrooms that constantly move from left to right and changes light and move around";
//   const { browser } = await generateImage(prompt, true, false);

//   await generateVideo(prompt, 24, 5);
// })();

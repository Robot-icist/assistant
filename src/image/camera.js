import { VideoCapture } from "camera-capture";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

const pictureDir = `${__dirname}/pictures`;

const videoDir = `${__dirname}/videos`;

const multiplier = 2;
const cameraWidth = 480 * multiplier;
const cameraHeight = 320 * multiplier;

export const videoCapture = new VideoCapture({
  mime: "image/jpeg",
  // mime: "image/png",
  port: 8081,
  width: cameraWidth,
  height: cameraHeight,
});

if (!fs.existsSync(pictureDir)) {
  fs.mkdirSync(pictureDir);
}

if (!fs.existsSync(videoDir)) {
  fs.mkdirSync(videoDir);
}

export const initialize = async () => {
  await videoCapture.initialize();
};

export const start = async () => {
  await videoCapture.start();
};

export const stop = async () => {
  await videoCapture.stop();
};

export const takePictureJpeg = async (path = pictureDir + "/tmp.jpg") => {
  // await c.initialize();
  let f = await videoCapture.readFrame("image/jpeg"); // jpeg
  if (path == null) return f.data;
  fs.writeFileSync(path, f.data);
  return f.data;
  // await c.stop();
  ////////////////////////////////////////////////////
  // let f = await c.readFrame(); // PNG as configured
  // writeFileSync("tmp.png", f.data);
  // let f = await c.readFrame("image/webp"); // take another shot this time as webp i mage
  // writeFileSync("tmp.webp", f.data);
  // let f = await c.readFrame("rgba"); // raw image data (as default)
  // writeFileSync("tmp-8bit-200x200.rgba", f.data);
};

export const takeVideo = async (path = videoDir + "/tmp6.webm", ms = 2500) => {
  // await c.initialize();
  await videoCapture.startRecording();
  await new Promise((res, rej) => setTimeout(res, ms));
  const data = await videoCapture.stopRecording();
  if (path == null) return data;
  fs.writeFileSync(path, data);
  // await c.stop();
};

export default {
  initialize,
  start,
  stop,
  takePictureJpeg,
  takeVideo,
  videoCapture,
};

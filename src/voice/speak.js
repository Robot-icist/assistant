import say from "say";
import { LOG } from "../utils/log.js";
import { ttsProcess } from "./tts.js";
import { exec } from "child_process";
import {
  generateFaceVideo,
  videoGenerationProcess,
} from "../image/videoGenerationProcess.js";
import fs from "fs";
import { firstOrderModelProcess } from "../image/firstOrderModelProcess.js";
import { sleep } from "@nut-tree-fork/nut-js";
import { sadTalkerProcess } from "../image/sadTalkerProcess.js";
import { sendToAll } from "../../src/utils/ws.js";
import { playAudio } from "../audio/main.js";
import {
  convertToH264,
  createTempFileFromBuffer,
  deleteDir,
} from "../utils/helper.js";
import { runPowerShellAsAdmin } from "../utils/processRunner.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

const scriptPath = "./add-voices.ps1";

runPowerShellAsAdmin(scriptPath);

export function removeDiacritics(str) {
  return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

let lang = process.env.LANG == "fr" ? "fr" : "en";

export const setLang = (val) => {
  lang = val;
};

export const getLang = () => lang;

let audioOutput = `output.wav`;
let audioOutputPath = path.resolve(__dirname, `../python/${audioOutput}`);

const videoOutput = `generated.mp4`;
const videoOutputPath = path.resolve(
  __dirname,
  `../python/speech-driven-animation/${videoOutput}`
);

const images = [
  "C:/Projects/assistant/src/image/pictures/robert/robdoe.jpeg",
  "C:/Projects/assistant/src/image/pictures/pierre/nineycropped.bmp",
  "C:/Projects/assistant/src/image/pictures/robert/robdoe.jpeg",
  "C:/Projects/assistant/src/image/pictures/liam/liamneeson.jpg",
  "C:/Projects/assistant/src/image/pictures/scarlett/scarlett.jpeg",
  "C:/Projects/assistant/src/image/pictures/gilles/gilles.bmp",
  "C:/Projects/assistant/src/image/pictures/axel/telechargement(1).jpg",
  "C:/Projects/assistant/src/image/pictures/axel/telechargement.jpg",
];
const wavs = [
  "C:\\Projects\\assistant\\src\\python\\wavs\\bernardgabaytrim.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\pierrenineytrim.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\weapon.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\liamneeson.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\scarlett.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\gilles20.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\voixaxel2.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\voixaxel.wav",
];

let sourceId = process.env.ID ? process.env.ID : lang == "fr" ? 1 : 2;

let sourceImagePath = images[sourceId];

let speakerWavPath = wavs[sourceId];

export const setSpeakerId = (id) => {
  sourceId = id;
  sourceImagePath = images[id];
  speakerWavPath = wavs[id];
};

let video = process.env.VIDEO;

export const setVideo = (val) => {
  video = val;
};

let resolves = [];

deleteDir(path.resolve(__dirname, "../python/sadtalker/results"));

firstOrderModelProcess.events.on("done", (data) => {
  if (!video) return;
  // console.log("received fomm event done", data);
  let resolve = resolves.shift();
  resolve?.tempfile?.delete();
  resolve.resolve();
  console.timeEnd(resolve?.timeName);
});

videoGenerationProcess.events.on("done", (data) => {
  if (!video) return;
  // console.log("received event done", data);
  firstOrderModelProcess.sendCommand({
    config: "config/vox-adv-256.yaml",
    // config: "config/vox-256.yaml",
    checkpoint: "vox-adv-cpk.pth.tar",
    // checkpoint: "vox-cpk.pth.tar",
    sourceImage: sourceImagePath,
    drivingVideo: videoOutputPath,
    windowWidth: 600,
    windowsHeight: 600,
  });
});

sadTalkerProcess.events.on("done", async (data) => {
  if (!video) return;
  let filepath = data.split("\\").pop();
  let videoPath = path.resolve(
    __dirname,
    "../python/sadtalker/results",
    filepath
  );
  let convertedPath = path.resolve(
    __dirname,
    "../python/sadtalker/results",
    "converted.mp4"
  );
  console.log("received sadtalker event done", data, filepath, videoPath);
  let resolve = resolves.shift();

  await convertToH264(videoPath, convertedPath);
  process.env.MUTE &&
    fs.readFile(convertedPath, (err, data) => {
      if (err) {
        console.error("\nError reading the MP4 file:", err);
        return;
      }
      console.log("\nSending MP4 file...");
      // Send the WAV file as binary data
      sendToAll(data, true);
    });
  resolve?.tempfile?.delete();
  resolve.resolve();
  console.timeEnd(resolve?.timeName);
});

ttsProcess.events.on("done", async (data) => {
  // console.log("tts done event received", data);
  let resolve = resolves.shift();
  console.timeEnd(resolve?.timeName);
  if (!video && !process.env.MUTE) playAudio(audioOutputPath);
  // Read the WAV file as a buffer
  if (process.env.MUTE && !video)
    fs.readFile(audioOutputPath, (err, data) => {
      if (err) {
        console.error("\nError reading the WAV file:", err);
        return;
      }
      console.log("\nSending WAV file...");
      // Send the WAV file as binary data
      sendToAll(data, true);
    });

  if (!video) {
    resolve.resolve();
    return;
  }

  const fileBuffer = await fs.promises.readFile(audioOutputPath);
  const tempfile = await createTempFileFromBuffer(fileBuffer, "wav");
  const timeName = `video:${resolve.text}`;
  resolves.unshift({ ...resolve, tempfile, timeName });
  if (process.env.FOMM)
    generateFaceVideo(
      "C:/Projects/assistant/src/python/speech-driven-animation/example/image.bmp",
      tempfile.path,
      videoOutputPath,
      600,
      600,
      false
    );
  else
    sadTalkerProcess.sendCommand({
      drivenAudio: tempfile.path,
      sourceImage: sourceImagePath,
      still: false,
      enhance: false,
      play: process.env.MUTE ? false : true,
    });
  console.time(timeName);
});

export async function speak(text, speakerId = sourceId) {
  if (text.trim() === "") return;
  setSpeakerId(speakerId);
  await sleep(300);
  return new Promise((resolve, reject) => {
    try {
      if (process.env.TTS) {
        const timeName = `tts:${text}`;
        console.time(timeName);
        ttsProcess.sendCommand({
          text: text,
          speakerWav: speakerWavPath,
          language: lang,
          outputFile: audioOutput,
          playAudio: false,
        });
        resolves.push({ resolve, text, timeName });
      } else {
        say.getInstalledVoices(console.log);
        let voice = lang == "fr" ? "Microsoft Paul" : "Microsoft David";
        say.speak(removeDiacritics(text), voice, 1.0, (err) => {
          if (err) {
            return reject(err);
          }
          console.log(
            "\nSpokenText:",
            text
            // text.normalize("NFC"),
            // text.normalize("NFD")
          );
          return resolve();
        });
      }
    } catch (error) {
      console.log(error);
      resolve();
    }
  });
}

export async function stopSpeaking() {
  say.stop();
}

export default { removeDiacritics, speak, stopSpeaking };

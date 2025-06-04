import say from "say";
import { LOG } from "../global/log.js";
import { exec } from "child_process";
import fs from "fs";
import { sleep } from "@nut-tree-fork/nut-js";
import { sadTalkerProcess } from "../image/sadTalkerProcess.js";
import { sendToAll } from "../global/ws.js";
import { playAudio } from "../audio/main.js";
import {
  convertToH264,
  createTempFileFromBuffer,
  deleteDir,
  createTempFileName,
  deleteTempDir,
} from "../global/helper.js";
import { runPowerShellAsAdmin } from "../global/processRunner.js";
import { getProcessing } from "../../index.js";
import path from "path";
import { fileURLToPath } from "url";
import { ttsGradio, xttsGradio } from "./ttsGradio.js";
import { dreamtalkGradio } from "../image/dreamtalk-gradio.js";

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
  "C:/Projects/assistant/src/image/pictures/pierre/niney.bmp",
  "C:/Projects/assistant/src/image/pictures/robert/robdoe.jpeg",
  "C:/Projects/assistant/src/image/pictures/liam/liamneeson.jpg",
  "C:/Projects/assistant/src/image/pictures/scarlett/scarlett2.jpeg",
  "C:/Projects/assistant/src/image/pictures/brad/brad.jpg",
  "C:/Projects/assistant/src/image/pictures/eddie/eddie.jpg",
  "C:/Projects/assistant/src/image/pictures/jacques/jacques.jpeg",
  "C:/Projects/assistant/src/image/pictures/alain/alain.jpg",
  "C:/Projects/assistant/src/image/pictures/arnold/arnold.jpg",
  "C:/Projects/assistant/src/image/pictures/arnold/arnold.jpg",
  "C:/Projects/assistant/src/image/pictures/gilles/gilles.jpg",
  "C:/Projects/assistant/src/image/pictures/axel/JPEG_20240903_181141.jpg",
  "C:/Projects/assistant/src/image/pictures/axel/telechargement(1).jpg",
  // "C:/Projects/assistant/src/image/pictures/axel/telechargement.jpg",
];
const wavs = [
  "C:\\Projects\\assistant\\src\\python\\wavs\\bernardgabaytrim.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\pierrenineytrim.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\weapon.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\liamneeson.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\scarlett.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\brad.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\medhondo.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\jacques.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\alain12.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\danielberetta.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\arnold.wav",
  "C:\\Projects\\assistant\\src\\python\\wavs\\gilles.wav",
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

export const getVideo = () => {
  return video
};

export const setVideo = (val) => {
  video = val;
};

let resolves = [];

export const getResolves = () => resolves;
export const setResolves = (r) => resolves = r;

const resultsPath = path.resolve(__dirname, "../python/sadtalker/results");

deleteDir(resultsPath);

deleteTempDir();

export async function speak(text, speakerId = sourceId) {
  if (text.trim() === "" || !getProcessing()) return;
  setSpeakerId(speakerId);
  // await sleep(250);
  return new Promise(async (resolve, reject) => {
    try {
      if (process.env.TTS) {
        let timeName = `tts:${text}`;
        console.time(timeName);
        // resolves.push({ resolve, text, timeName });
        const data = await xttsGradio(`"${text}"`, lang, speakerWavPath);
        console.timeEnd(timeName);
        // console.log("ttsGradio data", data); 
        const resultpath = data[0].path;
        console.log("resultpath", resultpath);
        setTimeout(async () => {
          await fs.promises.unlink(resultpath);
          console.log("Temporary converted file deleted: ", resultpath);
        }, 60 * 1000);
        
        // if (!video && !process.env.MUTE) playAudio(resultpath);
        
        // // obsolete part as now xtts sends directly to the websocket
        // // Read the WAV file as a buffer
        // if (process.env.MUTE && !video && getProcessing())
        //   fs.readFile(resultpath, (err, data) => {
        //     if (err) {
        //       console.error("\nError reading the WAV file:", err);
        //       return;
        //     }
        //     console.log("\nSending WAV file...");
        //     // Send the WAV file as binary data
        //     sendToAll(data, true);
        //   });
        // if (!video) return resolve();
        return resolve();
        // await speakWithVideo(text, resultpath);
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

let isLocked = false; 

export async function speakWithVideo(text, resultpath, buffer = null) {
  while (isLocked) {
    console.log("speakWithVideo is currently locked. Waiting...");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  isLocked = true;
  sendToAll("loading:true");
  try {
    let timeName = `video:${text}`;
    console.time(timeName);
    const fileBuffer = buffer ? buffer : await fs.promises.readFile(resultpath);
    const tempfile = await createTempFileFromBuffer(fileBuffer, "wav");

    if (process.env.SADTALKER === "true") {
      const data = await sadTalkerProcess.sendCommand({
        drivenAudio: tempfile.path,
        sourceImage: sourceImagePath,
        still: true,
        enhance: false,
        play: process.env.MUTE ? false : true,
        batchSize: 32,
      });

      if (!video) return;

      let filepath = data.split("\\").pop();
      let videoPath = path.resolve(resultsPath, filepath);
      let convertedPath = createTempFileName("converted", "mp4");

      console.log(
        "received sadtalker event done",
        data,
        filepath,
        videoPath,
        convertedPath
      );

      if (process.env.MUTE) {
        await convertToH264(videoPath, convertedPath);
        fs.readFile(convertedPath, (err, data) => {
          if (err) {
            console.error("\nError reading the MP4 file:", err);
            return;
          }
          console.log("\nSending MP4 file...");
          sendToAll(data, true);
          setTimeout(async () => {
            try {
              await fs.promises.unlink(convertedPath);
              console.log("Temporary converted file deleted: ", convertedPath);
            } catch (error) {
              console.log("Temporary converted file deletion error");
            }
          }, 60 * 1000);
        });
      }

      tempfile.delete();
      console.timeEnd(timeName);
    } else {
      const videoData = await dreamtalkGradio(resultpath, sourceImagePath);
      console.timeEnd(timeName);

      const videoPath = videoData[0].video.path;
      console.log(videoPath);
      if (process.env.MUTE && getProcessing()) {
        fs.readFile(videoPath, (err, data) => {
          if (err) {
            console.error("\nError reading the MP4 file:", err);
            return;
          }
          console.log("\nSending MP4 file...");
          sendToAll(data, true);
          setTimeout(async () => {
            try {
              await fs.promises.unlink(videoPath);
              console.log("Temporary converted file deleted: ", videoPath);
            } catch (error) {
              console.log("Temporary converted file deletion error");
            }
          }, 60 * 1000);
        });
      }
    }
  } catch (error) {
    console.error("Error in speakWithVideo:", error);
  } finally {
    isLocked = false; // Release the lock
    sendToAll("loading:false");
  }
}

export async function stopSpeaking() {
  say.stop();
}

export default { removeDiacritics, speak, stopSpeaking };

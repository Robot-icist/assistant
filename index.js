import { hotword, customHotword } from "./src/voice/hotword.js";
import {
  startMicRecognition,
  stopMicRecognition,
  cleanupMicRecognition,
  recordAudioToFile,
} from "./src/voice/recognition.js";
import { ollamaChat, ollamaVision, stopStream } from "./src/llm/ollama.js";
import { removeDiacritics, speak } from "./src/voice/speak.js";
import {
  automation,
  playActions,
  replayMatchingRecordings,
} from "./src/automation/automation.js";
import {
  initialize,
  takePictureJpeg,
  takeVideo,
  stop,
} from "./src/image/camera.js";
import * as recognition from "./src/image/recognition.js";
import { ttsProcess } from "./src/voice/tts.js";
import { exec } from "child_process";
import {
  registerFace,
  registerHotword,
  registerVoiceClone,
} from "./src/utils/helper.js";
import { generateImage, generateVideo } from "./src/image/stable-diffusion.js";
import {
  generateFaceVideo,
  videoGenerationProcess,
} from "./src/image/videoGenerationProcess.js";
import { firstOrderModelProcess } from "./src/image/firstOrderModelProcess.js";
import { sadTalkerProcess } from "./src/image/sadTalkerProcess.js";
import { rl } from "./src/utils/rl.js";
import {
  audioQueue,
  getIsAudioProcessing,
  playAudio,
} from "./src/audio/main.js";
import { sendToAll, startWs, wss } from "./src/utils/ws.js";
import { sleep } from "@nut-tree-fork/nut-js";
import preventSleep from "node-prevent-sleep";
import {
  runExecutableWithArgs,
  runPowerShellAsAdmin,
} from "./src/utils/processRunner.js";
import { tunnel } from "./src/utils/tunnel.js";
import "dotenv/config";
import smartlife from "./src/automation/smartlife.js";
import path from "path";
import { fileURLToPath } from "url";
import { whisper } from "./src/voice/whisper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

// Set the default encoding for Node.js process
process.stdin.setDefaultEncoding("utf8");
process.stdout.setDefaultEncoding("utf8");
process.stderr.setDefaultEncoding("utf8");
// Buffer.encoding = 'utf8'; // Not recommended unless necessary
let processing = false;

let evil = false;

export const getProcessing = () => processing;
export const setProcessing = (val) => (processing = val);

export const getEvil = () => evil;
export const setEvil = (val) => {
  evil = val;
  if (evil) sendToAll("tomato", false);
  else sendToAll("deepskyblue", false);
};

runPowerShellAsAdmin(path.resolve(__dirname, "./src/llm/unload.ps1"));

if (process.env.GLOBAL) {
  (async () => await tunnel())();
}

if (process.env.TTS) {
  ttsProcess.start();
}

if (process.env.VIDEO) {
  if (process.env.FOMM) {
    videoGenerationProcess.start();
    firstOrderModelProcess.start();
  } else sadTalkerProcess.start();
}

if (process.env.WHISPER) {
  whisper.start();
}

preventSleep.enable();
// Graceful shutdown on interrupt signal
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully.");
  let { cleanupMicRecognition } = await import("./src/voice/recognition.js");
  cleanupMicRecognition();
  preventSleep.disable();
  process.exit();
});

export const Kill = async () => {
  Stop();
  await new Promise((res, rej) => {
    exec("taskkill /f /im python.exe", (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        rej(error);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
      res();
    });
  });
  process.kill(process.pid, "SIGINT");
};

export const Stop = () => {
  stopStream();
  setProcessing(false);
  sendToAll("loading:false");
  sendToAll("stop:true");
};

export const logic = async (recognizedText) => {
  if (recognizedText === "") return;
  if (recognizedText.includes("stop")) {
    return Stop();
    kill();
  }
  while (processing) await sleep(100);
  setProcessing(true);
  sendToAll("loading:true");
  recognizedText = removeDiacritics(recognizedText).toLowerCase().trim();
  if (recognizedText.includes("execute")) {
    let command = recognizedText.replace("execute", "").trim();
    replayMatchingRecordings(command);
    return;
  } else if (recognizedText.includes("program")) {
    let command = recognizedText.replace("program", "").trim();
    const KeyboardArray = [{ type: "keyboard", keys: "WIN R", time: 1000 }];
    [...command].forEach((char) =>
      KeyboardArray.push({ type: "keyboard", keys: `${char}`, time: 250 })
    );
    KeyboardArray.push({ type: "keyboard", keys: "ENTER", time: 2000 });
    await playActions(KeyboardArray);
  } else if (
    recognizedText.includes("type") ||
    recognizedText.includes("tape")
  ) {
    let command = recognizedText.replace("type", "").replace("tape", "").trim();
    const KeyboardArray = [];
    [...command].forEach((char) =>
      KeyboardArray.push({ type: "keyboard", keys: `${char}`, time: 250 })
    );
    KeyboardArray.push({ type: "keyboard", keys: "ENTER", time: 2000 });
    await playActions(KeyboardArray);
  } else if (
    recognizedText.includes("genere") ||
    recognizedText.includes("generate")
  ) {
    let prompt = recognizedText
      .replace("genere", "")
      .replace("generate", "")
      .trim();
    let data;
    if (prompt.includes("image")) {
      console.log(data);
      data = await generateImage(
        prompt,
        false,
        process.env.MUTE ? false : true
      );
      sendToAll(data.buffer, true);
    } else if (prompt.includes("video"))
      await generateVideo(
        prompt,
        24,
        2,
        false,
        process.env.MUTE ? false : true
      );
  } else if (
    recognizedText.includes("repete") ||
    recognizedText.includes("repeat")
  ) {
    let prompt = recognizedText
      .replace("repete", "")
      .replace("repeat", "")
      .replace("répète", "")
      .trim();
    await speak(prompt);
  } else if (
    recognizedText.includes("malefique") ||
    recognizedText.includes("evil")
  ) {
    if (recognizedText.includes("off") || recognizedText.includes("desactiv"))
      setEvil(false);
    else setEvil(true);
  } else if (
    recognizedText.includes("bascule") ||
    recognizedText.includes("toggle")
  ) {
    let replaced = recognizedText
      .replace("bascule", "")
      .replace("toggle", "")
      .trim();
    let devices = smartlife.getUserInfo().devices.filter(
      (d) => replaced.includes(removeDiacritics(d.name.trim().toLowerCase())) //&&
      // d.dev_type == "switch"
    );
    let device = devices.shift();
    console.log(devices, device);
    await smartlife.toggleDevice(device);
  } else if (
    recognizedText.includes("allume") ||
    recognizedText.includes("ouvre") ||
    recognizedText.includes("turn on") ||
    recognizedText.includes("open") ||
    recognizedText.includes("etein") ||
    recognizedText.includes("ferme") ||
    recognizedText.includes("turn off") ||
    recognizedText.includes("close")
  ) {
    let replaced = recognizedText
      .replace("allume", "")
      .replace("ouvre", "")
      .replace("turn on", "")
      .replace("open", "")
      .replace("etein", "")
      .replace("ferme", "")
      .replace("turn off", "")
      .replace("close", "")
      .trim();
    let devices = smartlife.getUserInfo().devices.filter(
      (d) => replaced.includes(removeDiacritics(d.name.trim().toLowerCase())) // &&
      // d.dev_type == "switch"
    );
    let device = devices.shift();
    console.log(devices, device);
    let onOrOff =
      recognizedText.includes("allume") ||
      recognizedText.includes("ouvre") ||
      recognizedText.includes("turn on") ||
      recognizedText.includes("open");
    await smartlife.adjustDevice(
      device,
      "turnOnOff",
      "value",
      device.dev_type == "scene" ? 1 : onOrOff ? 1 : 0
    );
  } else if (recognizedText.includes("vois") || recognizedText.includes("see"))
    await ollamaVision(recognizedText, speak, null);
  else if (recognizedText.includes("think") || recognizedText.includes("pense"))
    await ollamaChat(recognizedText, speak, "deepseek-r1:1.5b");
  else await ollamaChat(recognizedText, speak);
  setProcessing(false);
  sendToAll("loading:false");
};

let selectedHotwordRecognition = process.env.CUSTOM ? customHotword : hotword;

if (!process.env.MUTE)
  selectedHotwordRecognition((err, output) => {
    if (err) {
      console.error("\nHotword Error occurred:", err.message);
    } else {
      console.log("\nHotword output:", output);

      // Check for the keyword detection
      if (output.includes("Detected")) {
        console.log("\nHotword detected.");

        if (processing) return;

        playAudio(path.join(__dirname, "./src/audio/blip.mp3"));

        const recognition = () => {
          console.log("\nStarting microphone recognition.");
          // Start microphone recognition and handle results
          startMicRecognition(async (recognizedText) => {
            stopMicRecognition();
            console.log("\nRecognized text:", recognizedText);
            await logic(recognizedText);
            if (recognizedText !== "") {
              while (audioQueue.length > 0 && getIsAudioProcessing())
                await sleep(250);
              recognition();
            }
          });
        };
        recognition();
      }
    }
  });

try {
  (async () => {
    await smartlife.login();
    await smartlife.getDeviceList();
    // await speak("Hello Boss");
    // await registerFace();
    // await registerHotword();
    // await registerVoiceClone();
    // if (!process.env.TTS)
    // await recognition.loop();
    // automation();
    const question = () =>
      rl.question("Enter text: ", async (answer) => {
        console.log("text entered: ", answer);
        question();
        await logic(answer);
      });
    question();
  })();
} catch (error) {
  console.log(error);
}

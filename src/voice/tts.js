import { spawn } from "child_process";
import EventEmitter from "events";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

let controller = new AbortController();
let { signal } = controller;

const pythonScriptPath = path.resolve(__dirname, "../python/tts.py");
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path to the Anaconda activation script
const condaEnvName = "tf"; // Replace with your Anaconda environment name

class TTSProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
    this.events = new EventEmitter();
    this.controller = controller;
  }

  start() {
    const command = `${condaPromptPath} && activate ${condaEnvName} && python ${pythonScriptPath}`;

    this.process = spawn("cmd.exe", ["/c", command], {
      cwd: path.dirname(pythonScriptPath),
      stdio: ["pipe", "pipe", "pipe"],
      signal: signal,
      // env: { ...process.env, LANG: "fr_FR.UTF-8" }, // Ensure UTF-8 is set
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`\nPython TTS Script Output: ${output}`);
      if (output.includes("TTS Service Ready")) {
        this.isReady = true;
        this._processQueue();
      }
      if (output.includes("Audio generated and saved")) {
        this.events.emit("done", output);
      }
      if (output.includes("Audio played")) {
        this.events.emit("played", output);
      }
      if (output.toLowerCase().includes("error")) {
        this.events.emit("done", output);
      }
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nPython TTS Script Error: ${data}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nPython TTS process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start();
    });

    this.process.on("error", (code) => {
      console.log(`\nPython TTS process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start();
    });
  }

  sendCommand(params) {
    if (!this.isReady) {
      console.log("\nPython TTS process is not ready. Queuing the command.");
      this.queue.push(params);
      return;
    }
    // const command = `text=${params.text}|speaker_wav=${params.speakerWav}|language=${params.language}|output_file=${params.outputFile}|play_audio=${params.playAudio}|visualize=${params.visualize}|color=${params.color}\n`;
    const command = `text=${params.text}|speaker_wav=${params.speakerWav}|language=${params.language}|output_file=${params.outputFile}|play_audio=${params.playAudio}\n`;
    console.log(`\nSending command to Python TTS: ${command}`);
    this.process.stdin.write(command);
  }

  _processQueue() {
    while (this.queue.length > 0 && this.isReady) {
      const params = this.queue.shift();
      this.sendCommand(params);
    }
  }

  stop() {
    if (this.process) {
      // this.process.stdin.end();
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }
}

export const ttsProcess = new TTSProcess();

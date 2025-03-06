import { spawn } from "child_process";
import EventEmitter from "events";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

let controller = new AbortController();
let { signal } = controller;

const pythonScriptPath = path.resolve(
  __dirname,
  "../python/whisper_streaming_web/whisper_fastapi_online_server.py"
);
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path to the Anaconda activation script
const condaEnvName = "tf"; // Replace with your Anaconda environment name
const args = [
  "--host",
  "0.0.0.0",
  "--port",
  "10000",
  "--min-chunk-size",
  "1",
  "--buffer_trimming_sec",
  "5",
  "--vad",
  "--model",
  "small",
];
class WhisperProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
    this.events = new EventEmitter();
    this.controller = controller;
  }

  start() {
    const command = `${condaPromptPath} && activate ${condaEnvName} && python ${pythonScriptPath} ${args.join(
      " "
    )}`;

    this.process = spawn("cmd.exe", ["/c", command], {
      cwd: path.dirname(pythonScriptPath),
      stdio: ["pipe", "pipe", "pipe"],
      signal: signal,
      // env: { ...process.env, LANG: "fr_FR.UTF-8" }, // Ensure UTF-8 is set
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`\nPython Whisper Script Output: ${output}`);
      if (output.includes("WHISPER Service Ready")) {
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
      console.error(`\nPython WHISPER Script Error: ${data}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nPython WHISPER process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start();
    });

    this.process.on("error", (code) => {
      console.log(`\nPython WHISPER process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start();
    });
  }

  sendCommand(params) {
    if (!this.isReady) {
      console.log(
        "\nPython WHISPER process is not ready. Queuing the command."
      );
      this.queue.push(params);
      return;
    }
    const command = `${[...params].join(" ")}\n`;
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

export const whisper = new WhisperProcess();

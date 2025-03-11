import { spawn } from "child_process";
import EventEmitter from "events";
import path from "path";
import { fileURLToPath } from "url";
import { killProcessByPort } from "../utils/processRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  "1",
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
    this.restartDelay = 0; // Delay before restarting the process (e.g., 1 second)
    this.checkInterval = 5000; // Interval to check for responsiveness (e.g., 5 seconds)
    this.lastActivity = Date.now(); // Keep track of the time of the last activity
    this.timeout = null;
    this.timeoutCount = 0;
    this.activityCheckIntervalId = null; // Store the interval id to clear it later
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

      // Reset activity timer
      this.lastActivity = Date.now();

      if (output.includes("WHISPER Service Ready")) {
        this.isReady = true;
        this._processQueue();
        // this._startActivityCheck(); // Start the activity check when ready
      }
      // if (
      //   output.includes("FFmpeg stdout closed") ||
      //   output.includes("FFmpeg read timeout")
      // ) {
      //   this._cleanupAndRestart();
      // }
      if (output.includes("connection open")) {
        this._startActivityCheck();
      }

      if (output.includes("FFmpeg read timeout")) {
        clearTimeout(this.timeout);
        this.timeoutCount++;
        if (this.timeoutCount > 3) {
          this._cleanupAndRestart();
        }
        this.timeout = setTimeout(() => {
          this.timeoutCount = 0;
        }, 5000);
      }
      if (output.includes("Application startup complete")) {
        this._stopActivityCheck();
      }
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nPython WHISPER Script Error: ${data}`);

      // Reset activity timer on error too.  Errors can be a form of activity
      this.lastActivity = Date.now();

      // if (data.includes("connection closed")) {
      //   this._stopActivityCheck();
      // }
    });

    this.process.on("close", (code) => {
      console.log(`\nPython WHISPER process exited with code ${code}`);
      // this._cleanupAndRestart();
    });

    this.process.on("error", (err) => {
      console.error(`\nPython WHISPER process error: ${err}`);
      // this._cleanupAndRestart();
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

    // Reset activity timer on sending a command
    this.lastActivity = Date.now();
  }

  _processQueue() {
    while (this.queue.length > 0 && this.isReady) {
      const params = this.queue.shift();
      this.sendCommand(params);
    }
  }

  stop() {
    this._stopActivityCheck(); // Stop the activity check before stopping the process
    if (this.process) {
      killProcessByPort(10000);
      this.controller.abort();
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }

  _cleanupAndRestart() {
    this.stop();

    console.log(
      `\nRestarting Python WHISPER process in ${this.restartDelay}ms...`
    );
    setTimeout(() => {
      console.log("\nAttempting to restart Python WHISPER process...");
      controller = new AbortController();
      signal = controller.signal;
      this.start();
    }, this.restartDelay);
  }

  _startActivityCheck() {
    if (this.activityCheckIntervalId) {
      clearInterval(this.activityCheckIntervalId);
    }

    this.activityCheckIntervalId = setInterval(() => {
      const now = Date.now();
      const inactivityDuration = now - this.lastActivity;

      if (inactivityDuration > this.checkInterval) {
        console.warn(
          `\nPython WHISPER process seems unresponsive. No activity for ${inactivityDuration}ms. Restarting...`
        );
        this._cleanupAndRestart();
      }
    }, this.checkInterval);
  }

  _stopActivityCheck() {
    if (this.activityCheckIntervalId) {
      clearInterval(this.activityCheckIntervalId);
      this.activityCheckIntervalId = null;
    }
  }
}

export const whisper = new WhisperProcess();

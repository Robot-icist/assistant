import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import EventEmitter from "events";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

// Configuration
const pythonScriptPath = path.resolve(
  __dirname,
  "../python/sadtalker/inference_persistent.py"
); // Path to your Python script
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path to the Anaconda activation script
const condaEnvName = "tf"; // Replace with your Anaconda environment name

class SadTalkerProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
    this.events = new EventEmitter();
  }

  start() {
    const command = `${condaPromptPath} && activate ${condaEnvName} && python ${pythonScriptPath}`;

    this.process = spawn("cmd.exe", ["/c", command], {
      cwd: path.dirname(pythonScriptPath),
      stdio: ["pipe", "pipe", "pipe"], // pipe input and output streams
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nPython SadTalker Script Error: ${data.toString()}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nPython SadTalker process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start(); // Restart the process if it closes
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim(); // Convert data buffer to string
      console.log(`\nPython SadTalker Script Output: ${output}`);

      // Check if the Python script is ready to process requests
      if (output.includes("SadTalker Service Ready")) {
        this.isReady = true;
        this._processQueue(); // Start processing the queue once the process is ready
      } else if (output.includes("generated video")) {
        this.events.emit("done", output);
      }
    });
  }

  sendCommand(
    params = {
      drivenAudio: ".wav",
      sourceImage: ".jpg",
      still: true,
      enhance: false,
      play: true,
    }
  ) {
    if (!this.isReady) {
      console.log(
        "\nPython SadTalker process is not ready. Queuing the command."
      );
      this.queue.push(params); // If not ready, queue the command
      return;
    }

    // Prepare the command to send as a single string
    const command = `--driven_audio ${params.drivenAudio} --source_image ${
      params.sourceImage
    } ${params.still ? "--still" : ""} ${
      params.enhance ? "--enhancer gfpgan" : ""
    } --play ${params.play}\n`;
    console.log(`\nSending command to Python SadTalker: ${command}`);
    this.process.stdin.write(command); // Send the command to the Python process
  }

  _processQueue() {
    while (this.queue.length > 0 && this.isReady) {
      const params = this.queue.shift();
      this.sendCommand(params);
    }
  }

  stop() {
    if (this.process) {
      this.process.stdin.end();
      this.process = null;
      this.isReady = false;
    }
  }
}

// Export the process handler
export const sadTalkerProcess = new SadTalkerProcess();

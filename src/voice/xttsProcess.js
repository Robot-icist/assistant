import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import EventEmitter from "events";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

// Configuration
const pythonScriptPath = path.resolve(
  __dirname,
  "../python/xtts_gradio.py"
); // Path to your Python script
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path to the Anaconda activation script
const condaEnvName = "xtts"; // Replace with your Anaconda environment name

class XTTSProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
  }

  start() {
    const command = `${condaPromptPath} && activate ${condaEnvName} && python ${pythonScriptPath}`;

    this.process = spawn("cmd.exe", ["/c", command], {
      cwd: path.dirname(pythonScriptPath),
      stdio: ["pipe", "pipe", "pipe"], // pipe input and output streams
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nPython XTTS Script Error: ${data.toString()}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nPython XTTS process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start(); // Restart the process if it closes
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim(); // Convert data buffer to string
      console.log(`\nPython XTTS Script Output: ${output}`);
    });
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
export const xttsProcess = new XTTSProcess();

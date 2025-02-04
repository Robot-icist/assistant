import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import EventEmitter from "events";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

// Configuration
const pythonScriptPath = path.resolve(
  __dirname,
  "../python/first-order-model/first_order_model.py"
); // Path to your Python script
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path to the Anaconda activation script
const condaEnvName = "tf"; // Replace with your Anaconda environment name

class FirstOrderModelProcess {
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
      console.error(
        `\nPython FirstOrderModel Script Error: ${data.toString()}`
      );
    });

    this.process.on("close", (code) => {
      console.log(`\nPython FirstOrderModel process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      this.start(); // Restart the process if it closes
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim(); // Convert data buffer to string
      console.log(`\nPython FirstOrderModel Script Output: ${output}`);

      // Check if the Python script is ready to process requests
      if (output.includes("First Order Model Service Ready")) {
        this.isReady = true;
        this._processQueue(); // Start processing the queue once the process is ready
      } else if (output.includes("Video saved to")) {
        this.events.emit("done", output);
      }
    });
  }

  sendCommand(
    params = {
      config: "config/vox-256.yaml",
      checkpoint: "vox-cpk.pth.tar",
      sourceImage:
        "C:/Projects/assistant/src/python/speech-driven-animation/example/image.bmp",
      drivingVideo:
        "C:/Projects/assistant/src/python/speech-driven-animation/generated.mp4",
      windowWidth: 500,
      windowsHeight: 600,
    }
  ) {
    if (!this.isReady) {
      console.log(
        "\nPython FirstOrderModel process is not ready. Queuing the command."
      );
      this.queue.push(params); // If not ready, queue the command
      return;
    }

    // Prepare the command to send as a single string
    // config=config.yaml|checkpoint=checkpoint.pth.tar|source_image=source.png|driving_video=driving.mp4|result_video=result.mp4|relative=true|adapt_scale=true|cpu=false|audio=true
    const command = `config=${params.config}|checkpoint=${params.checkpoint}|source_image=${params.sourceImage}|driving_video=${params.drivingVideo}|window_width=${params.windowWidth}|window_height=${params.windowsHeight}\n`;
    console.log(`\nSending command to Python FirstOrderModel: ${command}`);
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
export const firstOrderModelProcess = new FirstOrderModelProcess();

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const pythonScriptPath = path.resolve(__dirname, "../python/chatterbox_gradio.py");
const condaPromptPath = "C:/Users/Gille/miniconda3/Scripts/activate.bat"; // Adjust this path if needed
const condaEnvName = "chatterbox"; // Replace with your environment name if different

class ChatterboxProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
  }

  start() {
    const command = `${condaPromptPath} && activate ${condaEnvName} && python ${pythonScriptPath}`;

    this.process = spawn("cmd.exe", ["/c", command], {
      cwd: path.dirname(pythonScriptPath),
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nChatterbox Script Error: ${data.toString()}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nChatterbox process exited with code ${code}`);
      this.isReady = false;
      this.process = null;
      // Restart after a short delay to avoid tight restart loops
      setTimeout(() => this.start(), 2000);
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`\nChatterbox Script Output: ${output}`);
      // Basic readiness detection: Gradio prints "Running on local URL" when it's ready
      if (/Running on/.test(output) || /http:\/\/127.0.0.1:7860/.test(output)) {
        this.isReady = true;
        console.log("Chatterbox Gradio server appears ready.");
      }
    });
  }

  stop() {
    if (this.process) {
      try {
        this.process.stdin.end();
      } catch (e) {
        // ignore errors on shutdown
      }
      this.process = null;
      this.isReady = false;
    }
  }
}

export const chatterboxProcess = new ChatterboxProcess();

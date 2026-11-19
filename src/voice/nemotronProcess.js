import { spawn } from "child_process";
import EventEmitter from "events";
import path from "path";
import { fileURLToPath } from "url";
import { killProcessByPort } from "../global/processRunner.js";
import { restartLocalTunnel } from "../global/tunnel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let controller = new AbortController();
let { signal } = controller;

const projectDir = path.resolve(__dirname, "../python/nemotron_asr");
const pythonScriptPath = path.resolve(
  projectDir,
  "nemotron_fastapi_online_server.py"
);
const _port = 10000;

const baseArgs = [
  "--host",
  "0.0.0.0",
  "--port",
  String(_port),
  // Legacy whisper_streaming_web flags are accepted as no-ops by the
  // Nemotron server, so the same startup line keeps working.
  "--min-chunk-size",
  "1",
  "--buffer_trimming_sec",
  "1",
  "--vad",
  "--model",
  "small",
];

class NemotronProcess {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.queue = [];
    this.events = new EventEmitter();
    this.controller = controller;
    this.restartDelay = 1000; // Delay before restarting the process
    this.maxRestarts = 5;
    this.restartCount = 0;
    this.stopping = false;
    killProcessByPort(_port).catch(() => {});
  }

  // Read env at start() time: index.js imports modules before dotenv.config().
  _buildArgs() {
    const args = [...baseArgs];

    const model = process.env.NEMOTRON_MODEL;
    if (model) {
      args.push("--asr-model", model);
    }

    const language = process.env.ASR_LANGUAGE;
    if (language) {
      args.push("--language", language);
    }

    const chunkMs = process.env.ASR_CHUNK_MS;
    if (chunkMs) {
      args.push("--chunk-ms", chunkMs);
    }

    const device = process.env.ASR_DEVICE;
    if (device) {
      args.push("--device", device);
    }

    return args;
  }

  start() {
    this.stopping = false;
    this.isReady = false;

    // `uv run --project <dir> python <script>` uses the project's own .venv,
    // creating/syncing it on first launch. No global Python install is used.
    // uv is spawned directly (not through cmd.exe): passing a pre-quoted command
    // string to cmd makes it forward the quote characters as part of the script
    // path, which Python then fails to open.  An argument array lets Node apply
    // the Windows quoting rules exactly once.
    const args = [
      "run",
      "--project",
      projectDir,
      "python",
      pythonScriptPath,
      ...this._buildArgs(),
    ];

    this.process = spawn(process.env.UV_EXE || "uv", args, {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      signal: signal,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this.process.stdout.on("data", (data) => {
      const output = data.toString().trim();
      console.log(`\nPython NEMOTRON Script Output: ${output}`);

      if (
        output.includes("NEMOTRON ASR Service Ready") ||
        output.includes("WHISPER Service Ready")
      ) {
        this.isReady = true;
        this.restartCount = 0;
        this._processQueue();
        restartLocalTunnel(_port);
      }
    });

    this.process.stderr.on("data", (data) => {
      console.error(`\nPython NEMOTRON Script Error: ${data}`);
    });

    this.process.on("close", (code) => {
      console.log(`\nPython NEMOTRON process exited with code ${code}`);
      this.isReady = false;
      this.process = null;

      if (!this.stopping && code !== 0) {
        this._scheduleRestart();
      }
    });

    this.process.on("error", (err) => {
      console.error(`\nPython NEMOTRON process error: ${err}`);
      if (err.code === "ENOENT") {
        console.error(
          "\n`uv` was not found in PATH. Install uv and run:\n" +
            `  uv sync --project "${projectDir}"`
        );
      }
    });
  }

  sendCommand(params) {
    if (!this.isReady) {
      console.log(
        "\nPython NEMOTRON process is not ready. Queuing the command."
      );
      this.queue.push(params);
      return;
    }

    // The Nemotron server has no stdin command loop (the protocol is entirely
    // WebSocket based), so commands are accepted and ignored.
  }

  _processQueue() {
    while (this.queue.length > 0 && this.isReady) {
      const params = this.queue.shift();
      this.sendCommand(params);
    }
  }

  stop() {
    this.stopping = true;
    if (this.process) {
      const pid = this.process.pid;
      killProcessByPort(_port).catch(() => {});

      // uv spawns python as a child. Killing only uv would orphan the server,
      // which keeps port 10000 busy and makes the next start fail to bind.
      if (process.platform === "win32" && pid) {
        spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        }).on("error", () => {});
      }

      this.controller.abort();
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }

  _scheduleRestart() {
    if (this.restartCount >= this.maxRestarts) {
      console.error(
        `\nPython NEMOTRON process failed ${this.restartCount} times; not restarting.`
      );
      return;
    }
    this.restartCount++;
    const delay = this.restartDelay * this.restartCount;

    console.log(`\nRestarting Python NEMOTRON process in ${delay}ms...`);
    setTimeout(() => {
      if (this.stopping) return;
      console.log("\nAttempting to restart Python NEMOTRON process...");
      controller = new AbortController();
      signal = controller.signal;
      this.controller = controller;
      this.start();
    }, delay);
  }
}

export const nemotron = new NemotronProcess();

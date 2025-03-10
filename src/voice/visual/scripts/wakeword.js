import { changeColor, getParams } from "./icosahedron.js";
import { sendParams, stopProcessing } from "./main.js";

const SENSITIVITIES = new Float32Array([0.75]);

const logic = async (text) => {
  try {
    if (text?.trim() === "") return;
    const params = getParams();
    !params.alwaysOn && params.whisper && (await toggleRecording());
    !params.alwaysOn && stopVoiceRecognition();
    !params.alwaysOn && changeColor("deepskyblue");
    console.log("recognized", text);
    !params.whisper && displayText(text);
    if (
      text.toLowerCase().includes("vois") ||
      text.toLowerCase().includes("see")
    ) {
      sendParams();
      let front =
        text.toLowerCase().includes("devant") ||
        text.toLowerCase().includes("front");

      return await takePicture(front ? "user" : "environment");
    } else if (text.toLowerCase().includes("stop")) {
      stopProcessing();
    } else sendParams(text);
  } catch (error) {
    console.log("Error processing text:", error);
  }
};

const whisperCallback = async (err, text) => {
  if (err) return;
  const params = getParams();
  await logic(text);
  if (params.alwaysOn) {
    await toggleRecording(whisperCallback);
    await toggleRecording(whisperCallback);
  }
};

export const processCallback = async (wakeword) => {
  console.log("Recognized WakeWord:", wakeword);
  changeColor("gold");
  const params = getParams();
  if (params.whisper) {
    await toggleRecording(whisperCallback);
  } else
    await startVoiceRecognition("/scripts/" + params.model, async (data) => {
      await logic(data.text);
    });
};

let audioManagerErrorCallback = (ex) => {
  alert(ex.toString());
};

let readyCallback = () => {};

let started = false;

export const startWakewordRecognition = () => {
  try {
    PorcupineManager.start(
      { [getParams().wakeword]: KEYWORDS_ID[getParams().wakeword] },
      new Float32Array([SENSITIVITIES[0]]),
      processCallback,
      audioManagerErrorCallback,
      readyCallback,
      "/scripts/porcupine_worker.js",
      "/node_modules/@picovoice/web-voice-processor/src/downsampling_worker.js"
    );
    started = true;
    console.log("WakeWord Recognition Started");
  } catch (error) {
    console.log("Porcupine start handled error:", error);
  }
};

export const stopWakewordRecognition = function () {
  if (!started) return;
  try {
    PorcupineManager.stop();
    started = false;
    console.log("WakeWord Recognition Stopped");
  } catch (error) {
    console.log("Porcupine stop handled error:", error);
  }
};

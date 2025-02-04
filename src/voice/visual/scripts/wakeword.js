import { changeColor, getParams } from "./icosahedron.js";
import { sendParams } from "./main.js";

const SENSITIVITIES = new Float32Array([0.75]);

let processCallback = async (keyword) => {
  console.log("Recognized Keyword:", keyword);
  changeColor("gold");
  const params = getParams();
  await startVoiceRecognition("/scripts/" + params.model, async (data) => {
    !params.alwayson && stopVoiceRecognition();
    !params.alwayson && changeColor("deepskyblue");
    console.log("recognized", data);
    displayText(data.text + "\n");
    if (
      data.text.toLowerCase().includes("vois") ||
      data.text.toLowerCase().includes("see")
    ) {
      sendParams();
      let front =
        data.text.toLowerCase().includes("devant") ||
        data.text.toLowerCase().includes("front");

      return await takePicture(front ? "user" : "environment");
    }
    WS.send(
      JSON.stringify({
        text: data.text,
        lang: params.model.includes("fr") ? "fr" : "en",
        speaker: params.speaker,
        video: params.video,
        google: params.google,
      })
    );
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
    console.log("Wakeword Recognition Started");
  } catch (error) {
    console.log("Porcupine start handled error:", error);
  }
};

export const stopWakewordRecognition = function () {
  if (!started) return;
  try {
    PorcupineManager.stop();
    started = false;
    console.log("Wakeword Recognition Stopped");
  } catch (error) {
    console.log("Porcupine stop handled error:", error);
  }
};

startWakewordRecognition();

let modelInstance = null;
let recognizer = null;
let audioContext = null;
let mediaStream = null;
let recognizerProcessor = null;
let modelPath = null;

async function loadModel(
  newModelPath = "/scripts/vosk-model-small-fr-pguyot-0.3.tar.gz"
) {
  if (!modelInstance || newModelPath != modelPath) {
    modelPath = newModelPath;
    modelInstance = await Vosk.createModel(modelPath);
    console.log("Vosk Model Loaded");
  }
  return modelInstance;
}

// (async () => await loadModel())();

async function startVoiceRecognition(
  modelPath = "/scripts/vosk-model-small-fr-pguyot-0.3.tar.gz",
  cb = null
) {
  if (recognizer) {
    console.warn("Recognition is already running.");
    return;
  }

  const channel = new MessageChannel();
  const model = await loadModel(modelPath);
  model.registerPort(channel.port1);
  model.setLogLevel(0);

  const sampleRate = 48000;
  recognizer = new model.KaldiRecognizer(sampleRate);
  recognizer.setWords(true);
  recognizer.on("result", (message) => {
    const result = message.result;
    // console.log(JSON.stringify(result, null, 2));
    if (cb) cb(result);
  });

  recognizer.on("partialresult", (message) => {
    const partial = message.result.partial;
    // if (partial !== "") console.log(JSON.stringify(message.result, null, 2));
    displayText(partial);
  });

  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate,
    },
  });

  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("/scripts/vosk-worker.js");
  recognizerProcessor = new AudioWorkletNode(
    audioContext,
    "recognizer-processor",
    {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
    }
  );

  recognizerProcessor.port.postMessage(
    { action: "init", recognizerId: recognizer.id },
    [channel.port2]
  );
  recognizerProcessor.connect(audioContext.destination);

  const source = audioContext.createMediaStreamSource(mediaStream);
  source.connect(recognizerProcessor);
  console.log("Voice Recognition Started");
}

function stopVoiceRecognition() {
  if (recognizerProcessor) {
    recognizerProcessor.disconnect();
    recognizerProcessor = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  recognizer = null;
  console.log("Voice Recognition stopped.");
}

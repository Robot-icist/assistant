PorcupineManager = (function () {
  let porcupineWorker;

  let start = function (
    keywordIDs,
    sensitivities,
    detectionCallback,
    errorCallback,
    initCallback,
    porcupineWorkerScript,
    downsamplingScript
  ) {
    porcupineWorker = new Worker(porcupineWorkerScript);

    let engine = this;

    // ppn-init message from the worker signals that the ppn wasm has fully loaded and ready for processing
    porcupineWorker.onmessage = function (messageEvent) {
      if (messageEvent.data.status === "ppn-init") {
        porcupineWorker.postMessage({
          command: "init",
          keywordIDs: keywordIDs,
          sensitivities: sensitivities,
        });

        WebVoiceProcessor.start([engine], downsamplingScript, errorCallback);
        initCallback();
      } else {
        detectionCallback(messageEvent.data.keyword);
      }
    };
  };

  let stop = function () {
    WebVoiceProcessor.stop();
    porcupineWorker.postMessage({ command: "release" });
    porcupineWorker = null;
  };

  let processFrame = function (frame) {
    porcupineWorker.postMessage({ command: "process", inputFrame: frame });
  };

  return { start: start, processFrame: processFrame, stop: stop };
})();

let callback = function callback() {
  postMessage({ status: "ppn-init" });
};
let PorcupineOptions = { callback: callback };

importScripts("pv_porcupine.js");
importScripts("porcupine.js");

onmessage = function (e) {
  switch (e.data.command) {
    case "init":
      init(e.data.keywordIDs, e.data.sensitivities);
      break;
    case "process":
      process(e.data.inputFrame);
      break;
    case "pause":
      paused = true;
      break;
    case "resume":
      paused = false;
      break;
    case "release":
      release();
      break;
  }
};

let keywordIDArray;
let keywords;
let sensitivities;
let paused;
let porcupine = null;

function init(keywordIDs, _sensitivities_) {
  paused = false;
  keywordIDArray = Object.values(keywordIDs);
  keywords = Object.keys(keywordIDs);
  sensitivities = _sensitivities_;
  porcupine = Porcupine.create(keywordIDArray, sensitivities);
}

function process(inputFrame) {
  if (porcupine !== null && !paused) {
    let keywordIndex = porcupine.process(inputFrame);
    if (keywordIndex !== -1) {
      postMessage({
        keyword: keywords[keywordIndex],
      });
    }
  }
}

function release() {
  if (porcupine !== null) {
    porcupine.release();
  }

  porcupine = null;
  close();
}

import * as THREE from "/node_modules/three/build/three.module.js";
import { GUI } from "/node_modules/dat.gui/build/dat.gui.module.js";
import { EffectComposer } from "/node_modules/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "/node_modules/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "/node_modules/three/examples/jsm/postprocessing/OutputPass.js";
import {
  processCallback,
  startWakewordRecognition,
  stopWakewordRecognition,
} from "./wakeword.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const SAMPLE_RATE = 16000;

let color = "deepskyblue";

let threeColor = new THREE.Color(color);

const params = {
  color: color,
  red: threeColor.r,
  green: threeColor.g,
  blue: threeColor.b,
  strength: 0.2,
  radius: 0.2,
  threshold: 0.3,
  details: 30,
  size: 4,
  wakeword: "Jarvis",
  model: "vosk-model-small-fr-pguyot-0.3.tar.gz",
  llm: "llama3.2",
  speaker: 0,
  video: false,
  google: false,
  alwaysOn: false,
  keepInMemory: false,
};

export const getParams = () => params;

renderer.outputColorSpace = THREE.SRGBColorSpace;

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight)
);
bloomPass.strength = params.strength;
bloomPass.radius = params.radius;
bloomPass.threshold = params.threshold;

const bloomComposer = new EffectComposer(renderer);
bloomComposer.addPass(renderScene);
bloomComposer.addPass(bloomPass);

const outputPass = new OutputPass();
bloomComposer.addPass(outputPass);

camera.position.set(0, -2, 14);
camera.lookAt(0, 0, 0);

const uniforms = {
  u_time: { type: "f", value: 0.0 },
  u_frequency: { type: "f", value: 0.0 },
  u_red: { type: "f", value: params.red },
  u_green: { type: "f", value: params.green },
  u_blue: { type: "f", value: params.blue },
};

const mat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: document.getElementById("vertexshader").textContent,
  fragmentShader: document.getElementById("fragmentshader").textContent,
});

let geo = new THREE.IcosahedronGeometry(params.size, params.details);
let mesh = new THREE.Mesh(geo, mat);
scene.add(mesh);
mesh.material.wireframe = true;

let listener;

// Create a single AudioContext
let audioContext; // = new (window.AudioContext || window.webkitAudioContext)();

// Create an analyser node in the same audio context
let analyser = { getByteFrequencyData: () => {} }; //= audioContext.createAnalyser();
// analyser.fftSize = 256; // Set FFT size for frequency data
// analyser.fftSize = 32; // Set FFT size for frequency data

let microphoneStream;

// // Play the sound when the user clicks
// document.body.addEventListener("click", function () {

// // Resume AudioContext on first user interaction (click)
// if (audioContext.state === "suspended") {
//   audioContext.resume();
// }

// Create a MediaStreamSource from the microphone stream in the same AudioContext
navigator.mediaDevices
  .getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      sampleRate: SAMPLE_RATE,
    },
  })
  .then((stream) => {
    microphoneStream = stream;

    listener = new THREE.AudioListener();
    camera.add(listener);

    // Create a single AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create an analyser node in the same audio context
    analyser = audioContext.createAnalyser();
    // analyser.fftSize = 256; // Set FFT size for frequency data
    analyser.fftSize = 32; // Set FFT size for frequency data
    // Create a MediaStreamSource for the microphone input
    const microphone = audioContext.createMediaStreamSource(stream);

    // Connect the microphone to the analyser node
    microphone.connect(analyser);

    // Create a custom analyser for frequency data
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  })
  .catch((error) => {
    console.error("Error accessing the microphone:", error);
  });

// guiDisplayed = !guiDisplayed;
// if (guiDisplayed) gui.show();
// else gui.hide();

// });

// Create a custom analyser for frequency data
let dataArray = []; // = new Uint8Array(analyser.frequencyBinCount);

export const gui = new GUI();

//position gui
document.getElementsByClassName("dg ac")[0].style.top = "0";
document.getElementsByClassName("dg ac")[0].style.display = "flex";
document.getElementsByClassName("dg ac")[0].style.justifyContent =
  "space-around";

gui.useLocalStorage = true;

let guiDisplayed = true;

gui.remember(params);

export const changeColor = (value) => {
  threeColor = new THREE.Color(value);
  color = value;
  params.color = color;
  params.red = threeColor.r;
  params.green = threeColor.g;
  params.blue = threeColor.b;
  uniforms.u_red.value = threeColor.r;
  uniforms.u_green.value = threeColor.g;
  uniforms.u_blue.value = threeColor.b;
  colorsFolder.updateDisplay();
};
const colors = [
  "white",
  "grey",
  "deepskyblue",
  "tomato",
  "gold",
  "yellowgreen",
  "darkviolet",
  "deeppink",
];
const colorsFolder = gui.addFolder("Colors");
colorsFolder.add(params, "color", colors).onChange((value) => {
  changeColor(value);
});
colorsFolder.add(params, "red", 0, 1, 0.1).onChange((value) => {
  uniforms.u_red.value = Number(value);
  colorsFolder.updateDisplay();
});
colorsFolder.add(params, "green", 0, 1, 0.1).onChange((value) => {
  uniforms.u_green.value = Number(value);
  colorsFolder.updateDisplay();
});
colorsFolder.add(params, "blue", 0, 1, 0.1).onChange((value) => {
  uniforms.u_blue.value = Number(value);
  colorsFolder.updateDisplay();
});

const bloomFolder = gui.addFolder("Bloom");
bloomFolder.add(params, "threshold", 0, 1, 0.1).onChange((value) => {
  bloomPass.threshold = Number(value);
});
bloomFolder.add(params, "strength", 0, 3, 0.1).onChange((value) => {
  bloomPass.strength = Number(value);
});
bloomFolder.add(params, "radius", 0, 1, 0.1).onChange((value) => {
  bloomPass.radius = Number(value);
});

const detailsFolder = gui.addFolder("Details");
detailsFolder.add(params, "size", 1, 10, 0.1).onChange((value) => {
  scene.remove(mesh);
  geo = new THREE.IcosahedronGeometry(value, params.details);
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  mesh.material.wireframe = true;
  params.size = Number(value);
});
detailsFolder.add(params, "details", 0, 50, 1).onChange((value) => {
  scene.remove(mesh);
  geo = new THREE.IcosahedronGeometry(params.size, value);
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  mesh.material.wireframe = true;
  params.details = Number(value);
});

const assistantFolder = gui.addFolder("Assistant");
assistantFolder
  .add(params, "wakeword", Object.keys(KEYWORDS_ID))
  .onChange(async (value) => {
    params.wakeword = value;
    try {
      stopWakewordRecognition();
      startWakewordRecognition();
    } catch (error) {
      console.log(error);
    }
  });

assistantFolder
  .add(params, "model", [
    "vosk-model-small-fr-pguyot-0.3.tar.gz",
    "vosk-model-small-en-us-0.15.tar.gz",
  ])
  .onChange(async (value) => {
    await loadModel("/scripts/" + value);
    params.model = value;
  });

assistantFolder
  .add(params, "llm", [
    "llama3.2:1b",
    "llama3.2",
    "qwen2.5",
    "phi3",
    "deepseek-r1:1.5b",
    "llama2-uncensored",
  ])
  .onChange(async (value) => {
    params.llm = value;
  });
assistantFolder.add(params, "speaker", 0, 12, 1).onChange((value) => {
  params.speaker = value;
});

assistantFolder.add(params, "video").onChange((value) => {
  params.video = value;
});

assistantFolder.add(params, "google").onChange((value) => {
  params.google = value;
});

assistantFolder.add(params, "alwaysOn").onChange(async (value) => {
  params.alwaysOn = value;
  if (value) {
    stopVoiceRecognition();
    await processCallback(params.wakeword);
  }
});

// assistantFolder.add(params, "keepInMemory").onChange(async (value) => {
//   params.keepInMemory = value;
// });

let mouseX = 0;
let mouseY = 0;

document.addEventListener("mousemove", (e) => {
  let windowHalfX = window.innerWidth / 2;
  let windowHalfY = window.innerHeight / 2;
  mouseX = (e.clientX - windowHalfX) / 100;
  mouseY = (e.clientY - windowHalfY) / 100;
});

// Accelerometer/Gyro version
function handleMotion(event) {
  let alpha = event.alpha; // Rotation around Z axis (compass direction)  (optional)
  let beta = event.beta; // Rotation around X axis (front-to-back tilt)
  let gamma = event.gamma; // Rotation around Y axis (left-to-right tilt)

  // Adjust sensitivity values to your liking. Experiment!
  const betaSensitivity = 20; // Higher values reduce sensitivity
  const gammaSensitivity = 20; // Higher values reduce sensitivity

  // Normalize the accelerometer data to a range suitable for screen coordinates.
  // You'll likely need to tweak these calculations to find the right feel.
  let windowHalfX = window.innerWidth / 2;
  let windowHalfY = window.innerHeight / 2;

  // Use beta and gamma to influence mouseX and mouseY.  Invert the signs if needed.
  mouseX = gamma / gammaSensitivity; // Gamma controls horizontal movement
  mouseY = beta / betaSensitivity; // Beta controls vertical movement

  // Scale mouseX and mouseY to fit within the desired range.  Important for accurate positioning
  mouseX = (mouseX * windowHalfX) / 100;
  mouseY = (mouseY * windowHalfY) / 100;
}

// Function to request and enable device motion events
function enableMotionControl() {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    // iOS 13+ requires explicit permission
    DeviceMotionEvent.requestPermission()
      .then((permissionState) => {
        if (permissionState === "granted") {
          window.addEventListener("deviceorientation", handleMotion);
          console.log("Motion control enabled");
        } else {
          console.warn("Motion control permission denied.");
          // Optionally, display an error message to the user.
        }
      })
      .catch(console.error); // Handle potential errors in permission request
  } else {
    // Non-iOS 13+ (or if permission has already been granted)
    window.addEventListener("deviceorientation", handleMotion);
    console.log("Motion control enabled");
  }
}

enableMotionControl();

const clock = new THREE.Clock();

export let mediaStream;

export let mediaSource;

export const stopMediaStream = () => {
  mediaStream?.getTracks()?.forEach((track) => track?.stop());
  mediaSource?.stop();
};

export async function processWavBuffer(arrayBuffer) {
  // Decode the buffer into an AudioBuffer
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Create an AudioBufferSourceNode
  const source = audioContext.createBufferSource();
  mediaSource = source;
  source.buffer = audioBuffer;

  // Create a MediaStreamAudioDestinationNode
  const mediaStreamDestination = audioContext.createMediaStreamDestination();
  mediaStream = mediaStreamDestination.stream; // Obtain the MediaStream

  // Connect nodes: source → analyser → destination
  source.connect(analyser);
  analyser.connect(mediaStreamDestination);
  // source.connect(audioContext.destination); // Connect to output (optional) to hear it

  source.onended = () => {
    for (let track of microphoneStream.getAudioTracks()) {
      track.enabled = true;
    }
    changeColor("deepskyblue");
  };
  // Start playing the audio
  source.start();

  for (let track of microphoneStream.getAudioTracks()) {
    track.enabled = false;
  }
  changeColor("white");
}

function animate() {
  // Update frequency data
  analyser.getByteFrequencyData(dataArray);
  let averageFrequency = 0;
  for (let i = 0; i < dataArray.length; i++) {
    averageFrequency += dataArray[i];
  }
  averageFrequency /= dataArray.length;

  camera.position.x += (mouseX - camera.position.x) * 0.05;
  camera.position.y += (-mouseY - camera.position.y) * 0.5;
  camera.lookAt(scene.position);

  uniforms.u_time.value = clock.getElapsedTime();
  uniforms.u_frequency.value = averageFrequency;

  bloomPass.strength = 0.2 + averageFrequency / 1000;

  bloomComposer.render();
  requestAnimationFrame(animate);
}

animate();

window.addEventListener("resize", function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloomComposer.setSize(window.innerWidth, window.innerHeight);
});

gui.close();

gui.revert();

document.body.click();

WS.addCallback((data, isBinary, type) => {
  if (isBinary && type.includes("wav")) {
    processWavBuffer(data);
    return;
  }
  let value = data;
  if (!colors.includes(value)) return;

  changeColor(value);
});

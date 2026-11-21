import * as THREE from "three";
import { VRMLoaderPlugin } from "three-vrm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// MediaPipe Face Mesh for reliable face tracking
let faceMesh = null;
let faceMeshLoaded = false;
async function loadFaceMesh() {
  if (faceMeshLoaded) return;
  try {
    // Load MediaPipe Face Mesh from CDN
    const { FaceMesh } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1646424919/face_mesh.js");
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1646424919/${file}`
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    faceMeshLoaded = true;
    console.log("[Avatar] MediaPipe Face Mesh loaded");
  } catch (e) {
    console.error("[Avatar] Failed to load MediaPipe Face Mesh:", e);
    faceMeshLoaded = false;
  }
}

// ============ Configuration & State ============
const AVATAR_CONFIG_KEY = "vrm_avatar_config";

const defaultModelConfig = {
  showHeadOnly: false,
  headTrackingMode: "off",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: Math.PI, z: 0 }, // Default 180° Y rotation to face camera (front)
  scale: 1,
  cameraDistance: 3,
  cameraHeight: 1.5,
  cameraTarget: { x: 0, y: 1.2, z: 0 },  // Camera look-at target (pan offset)
  cameraAzimuth: 0,                      // Camera horizontal rotation (theta)
  cameraPolar: Math.PI / 3,              // Camera vertical rotation (phi, ~60° down)
  // Head-only mode specific settings (persisted separately)
  headOnlyPosition: { x: 0, y: 0, z: 0 },
  headOnlyRotation: { x: 0, y: Math.PI, z: 0 },
  headOnlyCameraDistance: 2.5,
  headOnlyCameraHeight: 1.6,
  headOnlyCameraTarget: { x: 0, y: 1.6, z: 0 },
  headOnlyCameraAzimuth: 0,
  headOnlyCameraPolar: Math.PI / 3,
  armPositions: {
    leftShoulder: { x: 0, y: 0, z: 0 },
    leftUpperArm: { x: 0, y: 0, z: 0 },
    leftLowerArm: { x: 0, y: 0, z: 0 },
    rightShoulder: { x: 0, y: 0, z: 0 },
    rightUpperArm: { x: 0, y: 0, z: 0 },
    rightLowerArm: { x: 0, y: 0, z: 0 },
  },
  idleEnabled: true,
  lipSyncEnabled: true,
  blinkEnabled: true,
  lookAtEnabled: true,
  
  // Blink configuration (human-like)
  blinkMinInterval: 2.0,      // Minimum seconds between blinks
  blinkMaxInterval: 6.0,      // Maximum seconds between blinks
  blinkDuration: 0.15,        // Blink speed (seconds for close/open)
  blinkHoldDuration: 0.08,    // How long eyes stay closed (seconds)
  doubleBlinkChance: 0.15,    // Chance of double blink (0-1)
  doubleBlinkDelay: 0.12,     // Delay between double blinks (seconds)
  
  // Idle animation configuration
  breathingEnabled: true,
  breathingRate: 0.3,         // Breaths per second (0.3 = ~18 breaths/min)
  breathingAmount: 0.02,      // Chest rotation amount (radians)
  
  headSwayEnabled: true,
  headSwayRateX: 0.15,        // Head sway X frequency
  headSwayRateY: 0.1,         // Head sway Y frequency
  headSwayAmountX: 0.01,      // Head sway X amount (radians)
  headSwayAmountY: 0.006,     // Head sway Y amount (radians)
  neckSwayFactor: 0.3,        // Neck follows head at this factor
  
  microMovementEnabled: true,
  microMovementRate: 0.05,    // Very slow random micro-movements
  microMovementAmount: 0.003, // Micro movement amount
};

const defaultGlobalConfig = {
  modelUrl: "/models/fem_vroid.vrm",
  windowBounds: { x: 10, y: 10, width: 400, height: 500 },
  modelConfigs: {},
  windowOpacity: 0.95,
};

let globalConfig = { ...defaultGlobalConfig };
let config = { ...defaultModelConfig };
let vrm = null;
let mixer = null;
let clock = new THREE.Clock();
let frameCount = 0;
let lastLogTime = performance.now();
let audioContext = null;
let analyser = null;
let audioSource = null;
let mediaElement = null;

// Three.js scene
let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let animationId = null;

// Lip sync
let lipSyncData = { vowels: { a: 0, i: 0, u: 0, e: 0, o: 0 }, silence: 0 };
let targetMorphTargets = { a: 0, i: 0, u: 0, e: 0, o: 0 };
let currentMorphTargets = { a: 0, i: 0, u: 0, e: 0, o: 0 };

// Idle animation
let idleTime = 0;
let blinkTimer = 0;
let blinkState = 0; // 0=open, 1=closing, 2=closed, 3=opening, 4=double-blink-delay
let nextBlinkTime = Math.random() * 3 + 2;
let isDoubleBlink = false;

// Head tracking
let videoElement = null;
let previewCanvas = null;        // Small preview canvas for UI
let previewContext = null;       // Context for preview canvas
let headTrackingActive = false;

// Mouse interaction
let isDragging = false;
let dragType = null; // "rotate", "pan", "zoom"
let lastMouseX = 0;
let lastMouseY = 0;
let targetRotation = new THREE.Euler(0, 0, 0);
let targetPosition = new THREE.Vector3(0, 0, 0);

// Window elements
let avatarWindow = null;
let avatarCanvas = null;
let settingsPanel = null;
let isSettingsOpen = false;
let resizeObserver = null;

// ============ Utility Functions ============
function loadConfig() {
  try {
    const saved = localStorage.getItem(AVATAR_CONFIG_KEY);
    if (saved) {
      globalConfig = { ...defaultGlobalConfig, ...JSON.parse(saved) };
      // Ensure modelUrl is always set
      if (!globalConfig.modelUrl) {
        globalConfig.modelUrl = defaultGlobalConfig.modelUrl;
      }
      // Load model-specific config
      const modelUrl = globalConfig.modelUrl;
      if (globalConfig.modelConfigs[modelUrl]) {
        config = { ...defaultModelConfig, ...globalConfig.modelConfigs[modelUrl] };
      } else {
        config = { ...defaultModelConfig };
      }
    }
  } catch (e) {
    console.warn("Failed to load avatar config:", e);
  }
}

function saveConfig() {
  try {
    // Save current model config
    const modelUrl = globalConfig.modelUrl;
    globalConfig.modelConfigs[modelUrl] = { ...config };
    localStorage.setItem(AVATAR_CONFIG_KEY, JSON.stringify(globalConfig));
  } catch (e) {
    console.warn("Failed to save avatar config:", e);
  }
}

function loadModelConfig(modelUrl) {
  if (globalConfig.modelConfigs[modelUrl]) {
    config = { ...defaultModelConfig, ...globalConfig.modelConfigs[modelUrl] };
  } else {
    config = { ...defaultModelConfig };
  }
}

function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ============ VRM Loading ============
async function loadVRM(url) {
  if (!url) {
    console.error("[Avatar] loadVRM called with undefined url, using default");
    url = "/models/fem_vroid.vrm";
  }
  // Load model-specific config before loading
  loadModelConfig(url);
  globalConfig.modelUrl = url;

  if (vrm) {
    scene.remove(vrm.scene);
    vrm.scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    if (mixer) mixer.uncacheRoot(vrm.scene);
    vrm = null;
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(url);
    vrm = gltf.userData.vrm;
    
    if (!vrm) {
      throw new Error("VRM not found in GLTF. Make sure the file is a valid VRM.");
    }
    
    scene.add(vrm.scene);

    // Initialize animation mixer
    mixer = new THREE.AnimationMixer(vrm.scene);

    // Scale and position (from model-specific config)
    vrm.scene.scale.setScalar(config.scale);
    vrm.scene.position.set(config.position.x, config.position.y, config.position.z);
    vrm.scene.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    // Sync targetRotation/Position so render loop doesn't fight
    targetRotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    targetPosition.set(config.position.x, config.position.y, config.position.z);

    // Play any built-in animations
    if (gltf.animations && gltf.animations.length > 0) {
      gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        action.play();
      });
    }

    // Setup VRM
    setupVRM();

    // Apply saved arm positions
    applyArmPositions();

    // Setup head-only mode
    updateHeadOnlyMode();

    // Update settings panel if open
    updateSettingsPanel();

    console.log("VRM loaded:", url);
    return vrm;
  } catch (error) {
    console.error("Failed to load VRM:", error);
    throw error;
  }
}

function setupVRM() {
  if (!vrm) return;

  // Enable look-at
  if (vrm.lookAt) {
    vrm.lookAt.autoUpdate = true;
    vrm.lookAt.eyesWeight = 1.0;
    vrm.lookAt.headWeight = 0.5;
    vrm.lookAt.bodyWeight = 0.2;
  }

  // Setup blink - disable auto blink so we can use our custom human-like blink system
  if (vrm.blink) {
    vrm.blink.autoUpdate = false;
  }

  // Setup spring bones for natural movement - exclude arm joints so manual arm positions work
  const armJointNames = new Set([
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"
  ]);
  if (vrm.springBoneManager) {
    vrm.springBoneManager.joints.forEach((joint) => {
      // Skip arm joints to allow manual control
      if (armJointNames.has(joint.name)) return;
      joint.stiffness = 0.8;
      joint.gravityPower = 0.5;
      joint.dragForce = 0.3;
    });
  }

  // Initialize expressions (three-vrm v2.x uses getExpression)
  // Apply saved expression weights if any
  applyExpressionWeights();
}

function applyExpressionWeights() {
  if (!vrm || !vrm.expressionManager) return;

  const expressions = {
    a: "a",
    i: "i",
    u: "u",
    e: "e",
    o: "o",
    blink: "blink",
    blink_l: "blink",
    blink_r: "blink",
  };

  Object.entries(expressions).forEach(([key, exprName]) => {
    const expr = vrm.expressionManager.getExpression(exprName);
    if (expr) {
      expr.weight = 0;
    }
  });
}

function updateHeadOnlyMode() {
  if (!vrm) return;

  const headBone = vrm.humanoid?.getNormalizedBoneNode("head");
  const neckBone = vrm.humanoid?.getNormalizedBoneNode("neck");

  // Head-related mesh name patterns (common in VRM models)
  const headMeshPatterns = [
    "head", "face", "hair", "eye", "eyelash", "eyebrow", "teeth", "tongue",
    "moustache", "beard", "glasses", "hat", "helmet", "ear", "earring"
  ];

  const isHeadMesh = (mesh) => {
    const name = mesh.name.toLowerCase();
    return headMeshPatterns.some(pattern => name.includes(pattern));
  };

  if (config.showHeadOnly) {
    // Save current full-body state before switching
    config.position = { x: vrm.scene.position.x, y: vrm.scene.position.y, z: vrm.scene.position.z };
    config.rotation = { x: vrm.scene.rotation.x, y: vrm.scene.rotation.y, z: vrm.scene.rotation.z };
    targetPosition.set(config.position.x, config.position.y, config.position.z);
    targetRotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    
    // Save full-body camera state
    if (camera && controls) {
      const distance = camera.position.distanceTo(controls.target);
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      config.cameraDistance = distance;
      config.cameraHeight = camera.position.y;
      config.cameraTarget = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      config.cameraAzimuth = Math.atan2(offset.x, offset.z);
      config.cameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    }

    // Hide body parts, show only head/face meshes
    vrm.scene.traverse((node) => {
      if (node.isMesh || node.isSkinnedMesh) {
        node.visible = isHeadMesh(node);
      }
    });

    // Apply head-only position/rotation
    vrm.scene.position.set(config.headOnlyPosition.x, config.headOnlyPosition.y, config.headOnlyPosition.z);
    vrm.scene.rotation.set(config.headOnlyRotation.x, config.headOnlyRotation.y, config.headOnlyRotation.z);
    targetPosition.set(config.headOnlyPosition.x, config.headOnlyPosition.y, config.headOnlyPosition.z);
    targetRotation.set(config.headOnlyRotation.x, config.headOnlyRotation.y, config.headOnlyRotation.z);

    // Apply head-only camera
    if (camera && controls) {
      const distance = config.headOnlyCameraDistance;
      const azimuth = config.headOnlyCameraAzimuth;
      const polar = config.headOnlyCameraPolar;
      const target = config.headOnlyCameraTarget;

      controls.target.set(target.x, target.y, target.z);
      const sinPolar = Math.sin(polar);
      camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      camera.lookAt(target.x, target.y, target.z);
      controls.update();
    }
  } else {
    // Save head-only state before switching back
    config.headOnlyPosition = { x: vrm.scene.position.x, y: vrm.scene.position.y, z: vrm.scene.position.z };
    config.headOnlyRotation = { x: vrm.scene.rotation.x, y: vrm.scene.rotation.y, z: vrm.scene.rotation.z };
    if (camera && controls) {
      const distance = camera.position.distanceTo(controls.target);
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      config.headOnlyCameraDistance = distance;
      config.headOnlyCameraHeight = camera.position.y;
      config.headOnlyCameraTarget = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      config.headOnlyCameraAzimuth = Math.atan2(offset.x, offset.z);
      config.headOnlyCameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    }

    // Show all
    vrm.scene.traverse((node) => {
      if (node.isMesh || node.isSkinnedMesh) {
        node.visible = true;
      }
    });

    // Restore full-body position/rotation
    vrm.scene.position.set(config.position.x, config.position.y, config.position.z);
    vrm.scene.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    targetPosition.set(config.position.x, config.position.y, config.position.z);
    targetRotation.set(config.rotation.x, config.rotation.y, config.rotation.z);

    // Restore full-body camera
    if (camera && controls) {
      const distance = config.cameraDistance;
      const azimuth = config.cameraAzimuth;
      const polar = config.cameraPolar;
      const target = config.cameraTarget;

      controls.target.set(target.x, target.y, target.z);
      const sinPolar = Math.sin(polar);
      camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      camera.lookAt(target.x, target.y, target.z);
      controls.update();
    }
  }
  
  saveConfig();
}

// ============ Arm Position Control ============
// VRM humanoid bone names (standardized in three-vrm)
const ARM_BONE_NAMES = {
  leftShoulder: "leftShoulder",
  leftUpperArm: "leftUpperArm", 
  leftLowerArm: "leftLowerArm",
  rightShoulder: "rightShoulder",
  rightUpperArm: "rightUpperArm",
  rightLowerArm: "rightLowerArm",
};

function applyArmPositions() {
  if (!vrm || !vrm.humanoid) return;

  Object.entries(config.armPositions).forEach(([key, value]) => {
    const boneName = ARM_BONE_NAMES[key];
    if (boneName && value) {
      const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        // Apply rotation in the correct order (XYZ)
        bone.rotation.x = value.x || 0;
        bone.rotation.y = value.y || 0;
        bone.rotation.z = value.z || 0;
      } else {
        console.warn(`[Avatar] Arm bone not found: ${boneName} (key: ${key})`);
      }
    }
  });
}

function setArmPosition(boneKey, x, y, z) {
  if (!vrm || !vrm.humanoid) return;

  const boneName = ARM_BONE_NAMES[boneKey];
  if (boneName) {
    const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (bone) {
      bone.rotation.x = x;
      bone.rotation.y = y;
      bone.rotation.z = z;
      config.armPositions[boneKey] = { x, y, z };
      saveConfig();
    } else {
      console.warn(`[Avatar] Cannot set arm position - bone not found: ${boneName}`);
    }
  }
}

// Debug: List available humanoid bones
function debugListHumanoidBones() {
  if (!vrm || !vrm.humanoid) return;
  console.log("[Avatar] Available humanoid bones:");
  const bones = [
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
    "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftEye", "rightEye", "jaw", "leftIndexProximal", "rightIndexProximal"
  ];
  bones.forEach(name => {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) console.log(`  ✓ ${name}`);
  });
}

// ============ Lip Sync ============
// Enhanced phoneme-based lip sync using multi-band frequency analysis
// Detects vowels (a, i, u, e, o) and consonants (bilabial, dental, velar) for natural mouth shapes

// VRM expression names for vowels (standard VRM expressions)
const VOWEL_EXPRESSIONS = {
  a: ["a", "aa", "A"],
  i: ["i", "ih", "I"],
  u: ["u", "uw", "U"],
  e: ["e", "eh", "E"],
  o: ["o", "oh", "O"],
};

// Phoneme frequency bands (in Hz) for better discrimination
// Based on acoustic phonetics - key frequency regions for different phoneme classes
const PHONEME_BANDS = {
  // Vowel formant regions
  vowel_a: { low: 600, high: 1000, weight: 1.0 },   // F1 for /a/
  vowel_a_f2: { low: 1000, high: 1600, weight: 0.7 }, // F2 for /a/
  vowel_i: { low: 200, high: 400, weight: 1.0 },    // F1 for /i/
  vowel_i_f2: { low: 2000, high: 3000, weight: 0.7 }, // F2 for /i/
  vowel_u: { low: 200, high: 400, weight: 1.0 },    // F1 for /u/
  vowel_u_f2: { low: 600, high: 1000, weight: 0.7 }, // F2 for /u/
  vowel_e: { low: 400, high: 700, weight: 1.0 },    // F1 for /e/
  vowel_e_f2: { low: 1600, high: 2400, weight: 0.7 }, // F2 for /e/
  vowel_o: { low: 400, high: 600, weight: 1.0 },    // F1 for /o/
  vowel_o_f2: { low: 800, high: 1200, weight: 0.7 }, // F2 for /o/
  
  // Consonant regions
  bilabial: { low: 100, high: 500, weight: 1.0 },     // m, b, p - low freq, nasal/oral
  dental: { low: 500, high: 2000, weight: 1.0 },      // t, d, n, s - mid freq
  velar: { low: 1000, high: 3000, weight: 0.8 },      // k, g, ng - higher freq
  fricative: { low: 2000, high: 6000, weight: 1.0 },  // s, z, sh, f - high freq noise
  
  // Overall energy bands
  lowEnergy: { low: 80, high: 300, weight: 1.0 },     // Fundamental + 1st harmonic
  midEnergy: { low: 300, high: 1000, weight: 0.8 },   // Formant region
  highEnergy: { low: 1000, high: 4000, weight: 0.6 }, // Frication + higher formants
};

let lipSyncWorker = null;
let audioWorkletNode = null;

// Smoothed phoneme state for temporal continuity
let lastPhonemeScores = { a: 0, i: 0, u: 0, e: 0, o: 0, bilabial: 0, dental: 0, velar: 0, fricative: 0 };
let phonemeHistory = []; // For temporal smoothing

function setupAudioAnalysis(audioEl) {
  if (!audioEl) return;

  mediaElement = audioEl;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  // Create analyser for real-time frequency data - larger FFT for better freq resolution
  if (!analyser) {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024; // Better frequency resolution
    analyser.smoothingTimeConstant = 0.15;
  }

  // Recreate audio source if element changed
  if (audioSource) {
    try { audioSource.disconnect(); } catch (e) {}
  }
  audioSource = audioContext.createMediaElementSource(audioEl);
  audioSource.connect(analyser);
  analyser.connect(audioContext.destination);

  // Also connect to a second analyser for time-domain data (waveform)
  if (!waveformAnalyser) {
    waveformAnalyser = audioContext.createAnalyser();
    waveformAnalyser.fftSize = 2048; // Better time resolution
    waveformAnalyser.smoothingTimeConstant = 0.05;
  }
  audioSource.connect(waveformAnalyser);
}

// Second analyser for waveform/amplitude analysis
let waveformAnalyser = null;

// Get energy in a frequency band
function getBandEnergy(freqData, sampleRate, band) {
  const fftSize = freqData.length * 2;
  const startBin = Math.max(0, Math.floor((band.low * fftSize) / sampleRate));
  const endBin = Math.min(freqData.length - 1, Math.floor((band.high * fftSize) / sampleRate));
  
  let sum = 0;
  let count = 0;
  for (let i = startBin; i <= endBin; i++) {
    sum += freqData[i];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// Detect phoneme scores from frequency spectrum using multi-band analysis
function detectPhonemesFromSpectrum(freqData, sampleRate = 44100) {
  const scores = {
    a: 0, i: 0, u: 0, e: 0, o: 0,
    bilabial: 0, dental: 0, velar: 0, fricative: 0
  };

  // Get energy in each phoneme band
  const bandEnergies = {};
  for (const [name, band] of Object.entries(PHONEME_BANDS)) {
    bandEnergies[name] = getBandEnergy(freqData, sampleRate, band) * band.weight;
  }

  // Vowel classification based on formant ratios
  // F1/F2 ratios are distinctive for each vowel
  const f1_a = bandEnergies.vowel_a;
  const f2_a = bandEnergies.vowel_a_f2;
  const f1_i = bandEnergies.vowel_i;
  const f2_i = bandEnergies.vowel_i_f2;
  const f1_u = bandEnergies.vowel_u;
  const f2_u = bandEnergies.vowel_u_f2;
  const f1_e = bandEnergies.vowel_e;
  const f2_e = bandEnergies.vowel_e_f2;
  const f1_o = bandEnergies.vowel_o;
  const f2_o = bandEnergies.vowel_o_f2;

  // Vowel scoring using formant patterns
  // /a/ - high F1, mid F2
  scores.a = (f1_a * 1.2 + f2_a * 0.5) / 2;
  // /i/ - low F1, high F2
  scores.i = (f1_i * 1.5 + f2_i * 1.2) / 2;
  // /u/ - low F1, low F2
  scores.u = (f1_u * 1.3 + f2_u * 0.8) / 2;
  // /e/ - mid F1, high F2
  scores.e = (f1_e * 1.1 + f2_e * 1.0) / 2;
  // /o/ - mid F1, mid-low F2
  scores.o = (f1_o * 1.0 + f2_o * 0.9) / 2;

  // Consonant scoring
  scores.bilabial = bandEnergies.bilabial;      // m, b, p - mouth closed
  scores.dental = bandEnergies.dental;          // t, d, n, s - tongue forward
  scores.velar = bandEnergies.velar;            // k, g - tongue back
  scores.fricative = bandEnergies.fricative;    // s, z, sh, f - high freq noise

  // Normalize vowel scores
  const vowelMax = Math.max(scores.a, scores.i, scores.u, scores.e, scores.o);
  if (vowelMax > 0) {
    scores.a /= vowelMax;
    scores.i /= vowelMax;
    scores.u /= vowelMax;
    scores.e /= vowelMax;
    scores.o /= vowelMax;
  }

  // Normalize consonant scores
  const consMax = Math.max(scores.bilabial, scores.dental, scores.velar, scores.fricative);
  if (consMax > 0) {
    scores.bilabial /= consMax;
    scores.dental /= consMax;
    scores.velar /= consMax;
    scores.fricative /= consMax;
  }

  // Temporal smoothing - keep history for stability
  phonemeHistory.push(scores);
  if (phonemeHistory.length > 3) phonemeHistory.shift();

  // Average over history
  const avgScores = { a: 0, i: 0, u: 0, e: 0, o: 0, bilabial: 0, dental: 0, velar: 0, fricative: 0 };
  for (const h of phonemeHistory) {
    for (const k of Object.keys(avgScores)) {
      avgScores[k] += h[k];
    }
  }
  for (const k of Object.keys(avgScores)) {
    avgScores[k] /= phonemeHistory.length;
  }

  // Additional smoothing with previous frame
  for (const k of Object.keys(avgScores)) {
    lastPhonemeScores[k] = THREE.MathUtils.lerp(lastPhonemeScores[k], avgScores[k], 0.3);
  }

  return { ...lastPhonemeScores };
}

function updateLipSync(deltaTime) {
  if (!config.lipSyncEnabled || !vrm || !vrm.expressionManager || !analyser) return;

  // Get frequency data
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);

  // Get time-domain data for amplitude
  const timeData = new Uint8Array(waveformAnalyser?.frequencyBinCount || 1024);
  if (waveformAnalyser) {
    waveformAnalyser.getByteTimeDomainData(timeData);
  }

  // Calculate RMS amplitude for jaw/overall openness
  let rmsSum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const sample = (timeData[i] - 128) / 128; // Convert to -1..1
    rmsSum += sample * sample;
  }
  const rms = Math.sqrt(rmsSum / timeData.length);
  const voiceActivity = Math.min(rms * 3.5, 1); // Scale and clamp

  // Detect phonemes from spectrum
  const phonemeScores = detectPhonemesFromSpectrum(freqData);

  // Map phonemes to VRM morph targets with distinct mouth shapes
  // Vowels drive primary mouth shape
  const vowelIntensity = voiceActivity;
  
  // Target vowel morphs - each vowel gets a distinct shape
  targetMorphTargets.a = phonemeScores.a * vowelIntensity;
  targetMorphTargets.i = phonemeScores.i * vowelIntensity;
  targetMorphTargets.u = phonemeScores.u * vowelIntensity;
  targetMorphTargets.e = phonemeScores.e * vowelIntensity;
  targetMorphTargets.o = phonemeScores.o * vowelIntensity;

  // Consonant modifications - these override/add to vowel shapes
  // Bilabials (m, b, p) - mouth closed, lips together
  const bilabialWeight = phonemeScores.bilabial * voiceActivity;
  
  // Fricatives (s, z, sh, f) - teeth close, lips spread
  const fricativeWeight = phonemeScores.fricative * voiceActivity;
  
  // Dental (t, d, n) - tongue up, slight mouth open
  const dentalWeight = phonemeScores.dental * voiceActivity;

  // Smooth morph target transitions - adaptive smoothing based on phoneme type
  // Vowels: slower smoothing for natural transitions
  // Consonants: faster for crisp articulation
  const vowelSmoothing = 0.15;
  const consonantSmoothing = 0.35;

  // Apply vowel morphs
  ["a", "i", "u", "e", "o"].forEach((key) => {
    currentMorphTargets[key] += (targetMorphTargets[key] - currentMorphTargets[key]) * vowelSmoothing;
    const expr = vrm.expressionManager?.getExpression(key);
    if (expr) {
      expr.weight = currentMorphTargets[key];
    }
  });

  // Handle jaw opening - base on voice activity, modified by consonants
  // Bilabials reduce jaw open, fricatives increase it slightly
  let jawOpen = voiceActivity * 1.8;
  
  // Reduce jaw for bilabials (m, b, p - lips closed)
  jawOpen *= (1 - bilabialWeight * 0.7);
  
  // Slight increase for fricatives (s, f - teeth apart)
  jawOpen += fricativeWeight * 0.2;
  
  // Dental consonants (t, d, n) - moderate jaw
  jawOpen = Math.max(jawOpen, dentalWeight * 0.4);
  
  jawOpen = Math.min(jawOpen, 1);

  const jawExpr = vrm.expressionManager?.getExpression("jawOpen") || vrm.expressionManager?.getExpression("aa");
  if (jawExpr) {
    // Smooth jaw movement
    jawExpr.weight += (jawOpen - jawExpr.weight) * 0.25;
  }

  // Apply consonant-specific mouth shapes
  // Bilabial: narrow mouth (funneled) - use 'u' or 'o' shape with jaw closed
  if (bilabialWeight > 0.3) {
    const uExpr = vrm.expressionManager?.getExpression("u");
    const oExpr = vrm.expressionManager?.getExpression("o");
    if (uExpr) uExpr.weight = Math.max(uExpr.weight, bilabialWeight * 0.6);
    if (oExpr) oExpr.weight = Math.max(oExpr.weight, bilabialWeight * 0.4);
  }

  // Fricative: spread lips (wide) - enhance 'i' and 'e' shapes
  if (fricativeWeight > 0.3) {
    const iExpr = vrm.expressionManager?.getExpression("i");
    const eExpr = vrm.expressionManager?.getExpression("e");
    if (iExpr) iExpr.weight = Math.max(iExpr.weight, fricativeWeight * 0.5);
    if (eExpr) eExpr.weight = Math.max(eExpr.weight, fricativeWeight * 0.4);
  }
}

// ============ Idle Animations ============
function updateIdleAnimations(deltaTime) {
  if (!config.idleEnabled || !vrm) return;

  idleTime += deltaTime;

  // Natural breathing - subtle chest movement (oscillating, not accumulating)
  if (config.breathingEnabled) {
    const chestBone = vrm.humanoid?.getNormalizedBoneNode("chest") || vrm.humanoid?.getNormalizedBoneNode("spine");
    if (chestBone) {
      const breathAmount = Math.sin(idleTime * config.breathingRate * Math.PI * 2) * config.breathingAmount;
      chestBone.rotation.x = THREE.MathUtils.lerp(chestBone.rotation.x, breathAmount, 0.1);
    }
  }

  // Subtle head sway - very gentle, natural movement (skip if head tracking is active)
  if (config.headSwayEnabled && !config.showHeadOnly && config.headTrackingMode === "off") {
    const headBone = vrm.humanoid?.getNormalizedBoneNode("head");
    const neckBone = vrm.humanoid?.getNormalizedBoneNode("neck");
    if (headBone && neckBone) {
      const swayX = Math.sin(idleTime * config.headSwayRateX * Math.PI * 2) * config.headSwayAmountX;
      const swayY = Math.cos(idleTime * config.headSwayRateY * Math.PI * 2) * config.headSwayAmountY;
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, swayX, 0.05);
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, swayY, 0.05);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, swayX * config.neckSwayFactor, 0.05);
    }
  }

  // Micro movements - very subtle random drift for natural feel
  if (config.microMovementEnabled && !config.showHeadOnly && config.headTrackingMode === "off") {
    const headBone = vrm.humanoid?.getNormalizedBoneNode("head");
    const neckBone = vrm.humanoid?.getNormalizedBoneNode("neck");
    if (headBone && neckBone) {
      // Use a separate slow timer for micro movements
      const microTime = idleTime * config.microMovementRate;
      const microX = Math.sin(microTime * 1.7) * config.microMovementAmount;
      const microY = Math.cos(microTime * 1.3) * config.microMovementAmount;
      const microZ = Math.sin(microTime * 0.9) * config.microMovementAmount * 0.5;
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, microX, 0.02);
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, microY, 0.02);
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, microZ, 0.02);
      neckBone.rotation.x = THREE.MathUtils.lerp(neckBone.rotation.x, microX * 0.5, 0.02);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, microZ * 0.5, 0.02);
    }
  }

  // Natural blinking with double-blink support
  if (config.blinkEnabled) {
    blinkTimer += deltaTime;
    
    if (blinkState === 0) {
      // Waiting for next blink
      if (blinkTimer >= nextBlinkTime) {
        blinkTimer = 0;
        nextBlinkTime = THREE.MathUtils.lerp(config.blinkMinInterval, config.blinkMaxInterval, Math.random());
        blinkState = 1; // Start closing
        // Determine if this will be a double blink
        isDoubleBlink = Math.random() < config.doubleBlinkChance;
      }
    } else if (blinkState === 1) {
      // Closing eyes
      const progress = Math.min(1, blinkTimer / config.blinkDuration);
      // Use ease-in for natural closing
      const easedProgress = progress * progress;
      setBlinkWeight(easedProgress);
      if (progress >= 1) {
        blinkTimer = 0;
        blinkState = 2; // Eyes closed
      }
    } else if (blinkState === 2) {
      // Holding eyes closed
      if (blinkTimer >= config.blinkHoldDuration) {
        blinkTimer = 0;
        if (isDoubleBlink) {
          blinkState = 4; // Double blink delay
        } else {
          blinkState = 3; // Start opening
        }
      }
    } else if (blinkState === 3) {
      // Opening eyes
      const progress = Math.min(1, blinkTimer / config.blinkDuration);
      // Use ease-out for natural opening
      const easedProgress = 1 - (1 - progress) * (1 - progress);
      setBlinkWeight(1 - easedProgress);
      if (progress >= 1) {
        blinkTimer = 0;
        blinkState = 0; // Back to waiting
      }
    } else if (blinkState === 4) {
      // Double blink delay - eyes stay open briefly
      if (blinkTimer >= config.doubleBlinkDelay) {
        blinkTimer = 0;
        blinkState = 1; // Second blink closing
        isDoubleBlink = false; // Only double blink once
      }
    }
  }
}

function setBlinkWeight(weight) {
  if (!vrm || !vrm.expressionManager) return;
  const blinkExpr = vrm.expressionManager.getExpression("blink");
  if (blinkExpr) blinkExpr.weight = weight;
  const blinkLExpr = vrm.expressionManager.getExpression("blink_l");
  if (blinkLExpr) blinkLExpr.weight = weight;
  const blinkRExpr = vrm.expressionManager.getExpression("blink_r");
  if (blinkRExpr) blinkRExpr.weight = weight;
}

// ============ Head Tracking ============
function createPreviewOverlay() {
  if (previewCanvas) return previewCanvas;
  
  previewCanvas = document.createElement("canvas");
  previewCanvas.width = 160;
  previewCanvas.height = 120;
  previewCanvas.style.cssText = `
    position: fixed;
    bottom: 100px;
    right: 20px;
    width: 160px;
    height: 120px;
    border: 2px solid #4ade80;
    border-radius: 8px;
    background: #000;
    z-index: 10001;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    image-rendering: pixelated;
  `;
  previewContext = previewCanvas.getContext("2d");
  document.body.appendChild(previewCanvas);
  return previewCanvas;
}

function removePreviewOverlay() {
  if (previewCanvas) {
    previewCanvas.remove();
    previewCanvas = null;
    previewContext = null;
  }
}

async function initHeadTracking(mode) {
  config.headTrackingMode = mode;
  saveConfig();

  if (mode === "off") {
    stopHeadTracking();
    return;
  }

  if (!videoElement) {
    videoElement = document.createElement("video");
    videoElement.style.display = "none";
    document.body.appendChild(videoElement);
  }

  // Create preview overlay (small 160x120 for UI)
  createPreviewOverlay();

  try {
    // Request higher resolution for detection
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    videoElement.srcObject = stream;
    await videoElement.play();
    
    // Load and configure MediaPipe Face Mesh
    await loadFaceMesh();
    if (faceMesh) {
      faceMesh.onResults(onFaceMeshResults);
    }
    
    headTrackingActive = true;
    trackFace();
  } catch (error) {
    console.error("Failed to start head tracking:", error);
    config.headTrackingMode = "off";
    saveConfig();
    removePreviewOverlay();
  }
}

function stopHeadTracking() {
  headTrackingActive = false;
  removePreviewOverlay();
  stopFaceMesh();
  if (videoElement && videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach((track) => track.stop());
    videoElement.srcObject = null;
  }
}

// MediaPipe Face Mesh tracking state
let faceMeshResults = null;
let faceMeshCanvas = null;
let faceMeshContext = null;

async function trackFace() {
  if (!headTrackingActive || !videoElement || !vrm) return;

  try {
    // Check video is ready
    if (videoElement.readyState < 2) { // HAVE_CURRENT_DATA
      if (headTrackingActive) requestAnimationFrame(trackFace);
      return;
    }

    // Ensure MediaPipe Face Mesh is loaded
    if (!faceMeshLoaded) {
      await loadFaceMesh();
      if (!faceMeshLoaded) {
        console.warn("[Avatar] Face Mesh not available, stopping head tracking");
        stopHeadTracking();
        return;
      }
    }

    // Process frame with MediaPipe Face Mesh
    // Send video frame to Face Mesh (it handles drawing internally)
    await faceMesh.send({ image: videoElement });

    // Get results from the last processed frame
    if (faceMeshResults && faceMeshResults.multiFaceLandmarks && faceMeshResults.multiFaceLandmarks.length > 0) {
      const landmarks = faceMeshResults.multiFaceLandmarks[0];
      
      // Draw preview with landmarks
      if (previewContext && previewCanvas) {
        drawPreviewOverlay(landmarks);
      }

      // Apply head tracking from landmarks
      applyHeadTrackingFromLandmarks(landmarks);
    }
  } catch (e) {
    console.error("[Avatar] trackFace error:", e);
  }

  // Only continue tracking if still active
  if (headTrackingActive) {
    requestAnimationFrame(trackFace);
  }
}

// MediaPipe Face Mesh callback
function onFaceMeshResults(results) {
  faceMeshResults = results;
}

function drawPreviewOverlay(landmarks) {
  if (!previewContext || !previewCanvas || !videoElement) return;
  
  const ctx = previewContext;
  const w = previewCanvas.width;
  const h = previewCanvas.height;
  
  // Draw video frame (flipped horizontally for mirror effect)
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoElement, 0, 0, w, h);
  ctx.restore();
  
  // Draw face landmarks
  if (landmarks) {
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 1;
    
    // Draw key points: nose tip (1), left eye (33), right eye (263), chin (152), forehead (10)
    const keyPoints = [1, 33, 263, 152, 10, 61, 291]; // nose, left eye, right eye, chin, forehead, mouth corners
    keyPoints.forEach(idx => {
      if (landmarks[idx]) {
        const x = landmarks[idx].x * w;
        const y = landmarks[idx].y * h;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#4ade80";
        ctx.fill();
      }
    });
    
    // Draw face outline (face oval)
    const faceOvalIndices = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
      377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
    ];
    ctx.beginPath();
    faceOvalIndices.forEach((idx, i) => {
      if (landmarks[idx]) {
        const x = landmarks[idx].x * w;
        const y = landmarks[idx].y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Mode indicator
    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.fillText(`Mode: ${config.headTrackingMode}`, 5, h - 5);
  }
}

function applyHeadTrackingFromLandmarks(landmarks) {
  if (!vrm || !vrm.humanoid) return;

  const headBone = vrm.humanoid.getNormalizedBoneNode("head");
  const neckBone = vrm.humanoid.getNormalizedBoneNode("neck");

  if (!headBone || !neckBone) return;

  // MediaPipe Face Mesh landmark indices:
  // 1 = nose tip, 33 = left eye inner corner, 263 = right eye inner corner
  // 152 = chin, 10 = forehead, 61 = mouth left, 291 = mouth right
  // 168 = nose bridge, 197 = nose bridge upper
  // 33/133 = left eye, 362/263 = right eye
  
  const noseTip = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const mouthLeft = landmarks[61];
  const mouthRight = landmarks[291];

  if (!noseTip || !leftEye || !rightEye) return;

  // Calculate head pose from landmarks
  // Eye center as reference for head center
  const eyeCenterX = (leftEye.x + rightEye.x) * 0.5;
  const eyeCenterY = (leftEye.y + rightEye.y) * 0.5;
  
  // Nose tip relative to eye center gives us head rotation
  const noseOffsetX = noseTip.x - eyeCenterX;
  const noseOffsetY = noseTip.y - eyeCenterY;
  
  // Calculate head rotation angles
  // X rotation (pitch): nose up/down relative to eyes
  // Y rotation (yaw): nose left/right relative to eyes
  // Z rotation (roll): eye line tilt
  
  const eyeVectorX = rightEye.x - leftEye.x;
  const eyeVectorY = rightEye.y - leftEye.y;
  const eyeDistance = Math.sqrt(eyeVectorX * eyeVectorX + eyeVectorY * eyeVectorY);
  
  // Normalize nose offset by eye distance for scale-invariant rotation
  const pitch = (noseOffsetY / eyeDistance) * 2.0;  // Up/down
  const yaw = (noseOffsetX / eyeDistance) * 2.0;    // Left/right
  
  // Roll from eye line tilt
  const roll = Math.atan2(eyeVectorY, eyeVectorX);
  
  // Sensitivity and smoothing
  const sensitivity = 1.0;
  const smoothing = 0.15;
  
  let targetYaw, targetPitch, targetRoll;
  
  if (config.headTrackingMode === "follow") {
    // Follow mode: avatar looks AT the user (opposite of user's head movement)
    // When user turns head left, avatar turns head right to maintain eye contact
    targetYaw = -yaw * sensitivity;
    targetPitch = -pitch * sensitivity * 0.7;
    targetRoll = -roll * sensitivity * 0.5;
  } else if (config.headTrackingMode === "mirror") {
    // Mirror mode: avatar copies user's head movement exactly
    targetYaw = yaw * sensitivity;
    targetPitch = pitch * sensitivity * 0.7;
    targetRoll = roll * sensitivity * 0.5;
  }
  
  // Apply smoothing
  targetRotation.y = THREE.MathUtils.lerp(targetRotation.y, targetYaw, smoothing);
  targetRotation.x = THREE.MathUtils.lerp(targetRotation.x, targetPitch, smoothing);
  targetRotation.z = THREE.MathUtils.lerp(targetRotation.z, targetRoll, smoothing);

  // Apply to bones
  headBone.rotation.y = targetRotation.y;
  headBone.rotation.x = targetRotation.x;
  headBone.rotation.z = targetRotation.z;
  neckBone.rotation.y = targetRotation.y * 0.3;
  neckBone.rotation.x = targetRotation.x * 0.3;
  neckBone.rotation.z = targetRotation.z * 0.3;

  // Also update lookAt target for eye tracking
  if (vrm.lookAt && vrm.lookAt.target) {
    if (vrm.lookAt.target instanceof THREE.Vector3) {
      // Look at target follows nose position
      vrm.lookAt.target.set(noseOffsetX * 3, -noseOffsetY * 2, 2);
    }
  }
}

// Cleanup function for face mesh
function stopFaceMesh() {
  if (faceMesh) {
    faceMesh.close();
    faceMesh = null;
    faceMeshLoaded = false;
  }
  faceMeshResults = null;
}

// ============ Three.js Scene Setup ============
function initThreeJS(canvas) {
  // Wait for canvas to have size
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    console.warn("[Avatar] Canvas has zero size, deferring init...");
    requestAnimationFrame(() => initThreeJS(canvas));
    return;
  }

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); // false = don't update CSS style (flex handles it)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Initialize lastKnownSize to prevent false resize on first check
  lastKnownSize = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
  };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;

  // Scene
  scene = new THREE.Scene();
  // Don't set scene.background - leave it null so canvas alpha shows window background
  // The window div has the background color with opacity, canvas has alpha: true
  // scene.background = null; // default is null, so transparent
  // backgroundAlpha is not needed when background is null
  // scene.backgroundAlpha = globalConfig.windowOpacity ?? 0.95; // Only works with background color

  // Camera
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, config.cameraHeight, config.cameraDistance);
  camera.lookAt(0, config.cameraHeight * 0.8, 0);

  // Controls
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 1;
  controls.maxDistance = 10;
  // Restore saved camera target (pan) or default
  controls.target.set(
    config.cameraTarget?.x ?? 0,
    config.cameraTarget?.y ?? config.cameraHeight * 0.8,
    config.cameraTarget?.z ?? 0
  );

  // Save camera position/rotation when user interacts
  let saveDebounceTimer = null;
  function scheduleCameraSave() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      saveConfig();
    }, 300); // Debounce rapid changes
  }

  controls.addEventListener("change", () => {
    if (!config) return;
    
    // Save full camera state: distance, height, target (pan), and spherical angles
    const distance = camera.position.distanceTo(controls.target);
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    
    if (config.showHeadOnly) {
      // Save to head-only camera config
      config.headOnlyCameraDistance = distance;
      config.headOnlyCameraHeight = camera.position.y;
      config.headOnlyCameraTarget = { 
        x: controls.target.x, 
        y: controls.target.y, 
        z: controls.target.z 
      };
      config.headOnlyCameraAzimuth = Math.atan2(offset.x, offset.z); // theta
      config.headOnlyCameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1)); // phi
    } else {
      // Save to full-body camera config
      config.cameraDistance = distance;
      config.cameraHeight = camera.position.y;
      config.cameraTarget = { 
        x: controls.target.x, 
        y: controls.target.y, 
        z: controls.target.z 
      };
      config.cameraAzimuth = Math.atan2(offset.x, offset.z); // theta
      config.cameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1)); // phi
    }
    
    scheduleCameraSave();
  });
  controls.addEventListener("end", () => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveConfig();
  });

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 7);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 5, -5);
  scene.add(fillLight);

  // Ground plane (invisible, for shadows)
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // Load initial model
  const modelUrl = globalConfig.modelUrl || "/models/fem_vroid.vrm";
  console.log("[Avatar] Loading model:", modelUrl);
  loadVRM(modelUrl).catch((err) => {
    console.error("[Avatar] Failed to load initial model:", err);
  });

  // Handle canvas resize - observe the canvasContainer (which actually changes size)
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  resizeObserver = new ResizeObserver(() => {
    try { scheduleResize(); } catch (e) { console.error("[Avatar] ResizeObserver error:", e); }
  });
  // Observe canvasContainer - it's the flex child that actually resizes
  const canvasContainer = avatarCanvas.parentElement;
  if (canvasContainer) {
    resizeObserver.observe(canvasContainer);
  }
  // Also observe canvas as fallback
  resizeObserver.observe(avatarCanvas);

  // Start animation loop
  animate();
}

function animate() {
  try {
    // Skip rendering if canvas is not visible (minimized/hidden)
    if (avatarCanvas && (avatarCanvas.offsetWidth === 0 || avatarCanvas.offsetHeight === 0 || avatarCanvas.style.display === "none" || !document.body.contains(avatarCanvas))) {
      animationId = requestAnimationFrame(animate);
      return;
    }

    // Check for WebGL context loss
    if (renderer && renderer.getContext()) {
      const gl = renderer.getContext();
      if (gl.isContextLost()) {
        console.warn("[Avatar] WebGL context lost, attempting to restore...");
        // Force context restoration attempt
        try {
          renderer.dispose();
        } catch (e) {}
        renderer = null;
      }
    }

    const deltaTime = Math.min(clock.getDelta(), 0.1); // Clamp to prevent large jumps

    // Fallback: check if canvas drawing buffer size changed (in case ResizeObserver missed it)
    if (avatarCanvas && renderer) {
      // Compare drawing buffer sizes (canvas.width/height), not CSS vs drawing buffer
      const expectedWidth = Math.floor(avatarCanvas.clientWidth * renderer.getPixelRatio());
      const expectedHeight = Math.floor(avatarCanvas.clientHeight * renderer.getPixelRatio());
      if (expectedWidth > 0 && expectedHeight > 0 && 
          (expectedWidth !== avatarCanvas.width || expectedHeight !== avatarCanvas.height)) {
        console.log("[Avatar] Drawing buffer size mismatch detected, resizing:", expectedWidth, "x", expectedHeight);
        onWindowResize();
      }
    }

    // Update animation mixer
    if (mixer) {
      mixer.update(deltaTime);
    }

    // Update VRM
    if (vrm && vrm.scene) {
      vrm.update(deltaTime);
      updateIdleAnimations(deltaTime);
      updateLipSync(deltaTime);

      // Apply arm positions AFTER vrm.update() so they're not overwritten by spring bones/animations
      applyArmPositions();

      // Always sync scene position and rotation to targetPosition/targetRotation
      // (targetPosition/targetRotation are kept in sync with config via sliders/buttons/loadVRM)
      // This ensures position/rotation persists and is restored on reload
      vrm.scene.position.lerp(targetPosition, 0.1);
      
      // Smoothly interpolate all rotation components, not just Y
      vrm.scene.rotation.x = THREE.MathUtils.lerp(vrm.scene.rotation.x, targetRotation.x, 0.1);
      vrm.scene.rotation.y = THREE.MathUtils.lerp(vrm.scene.rotation.y, targetRotation.y, 0.1);
      vrm.scene.rotation.z = THREE.MathUtils.lerp(vrm.scene.rotation.z, targetRotation.z, 0.1);
    }

    // Update controls
    if (controls) controls.update();

    // Render
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
      
      // Check for context loss after render
      if (renderer.getContext() && renderer.getContext().isContextLost()) {
        console.warn("[Avatar] Context lost detected after render");
        throw new Error("WebGL context lost after render");
      }
    }

    // Frame logging (every 5 seconds)
    frameCount++;
    const now = performance.now();
    if (now - lastLogTime > 5000) {
      console.log(`[Avatar] Frame ${frameCount}, deltaTime: ${deltaTime.toFixed(4)}, renderer: ${renderer ? 'ok' : 'null'}, vrm: ${vrm ? 'ok' : 'null'}`);
      lastLogTime = now;
    }
  } catch (error) {
    console.error("[Avatar] Render loop error:", error);
    // Attempt recovery for ANY error - be aggressive
    console.warn("[Avatar] Attempting full recovery...");
    if (renderer) {
      try { renderer.dispose(); } catch (e) {}
      renderer = null;
    }
    if (avatarCanvas) {
      // Re-init Three.js on next frame
      setTimeout(() => {
        if (avatarCanvas && !renderer && document.body.contains(avatarCanvas)) {
          try {
            initThreeJS(avatarCanvas);
            if (vrm && vrm.scene) {
              scene.add(vrm.scene);
            }
            console.log("[Avatar] Recovery successful");
          } catch (e) {
            console.error("[Avatar] Recovery failed:", e);
          }
        }
      }, 100);
    }
  }

  animationId = requestAnimationFrame(animate);
}

// ============ Window Management ============
function createAvatarWindow() {
  // Ensure config is loaded (in case called before DOMContentLoaded)
  loadConfig();
  
  if (avatarWindow) {
    avatarWindow.style.display = "flex";
    // Update opacity in case it changed
    const opacity = globalConfig.windowOpacity ?? 0.95;
    avatarWindow.style.background = `rgba(20, 20, 30, ${opacity})`;
    // Scene background is transparent (null), canvas alpha shows window background
    return avatarWindow;
  }

  const opacity = globalConfig.windowOpacity ?? 0.95;
  avatarWindow = document.createElement("div");
  avatarWindow.id = "avatar-window";
  avatarWindow.style.cssText = `
    position: fixed;
    left: ${globalConfig.windowBounds.x}px;
    top: ${globalConfig.windowBounds.y}px;
    width: ${globalConfig.windowBounds.width}px;
    height: ${globalConfig.windowBounds.height}px;
    background: rgba(20, 20, 30, ${opacity});
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    user-select: none;
  `;

  // Title bar
  const titleBar = document.createElement("div");
  titleBar.style.cssText = `
    height: 32px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    cursor: move;
    -webkit-app-region: drag;
  `;
  titleBar.innerHTML = `
    <span style="color: #fff; font-size: 13px; font-weight: 500;">VRM Avatar</span>
    <div style="display: flex; gap: 4px;">
      <button id="avatar-settings-btn" style="
        background: none; border: none; color: #aaa; cursor: pointer;
        padding: 4px 8px; border-radius: 4px; font-size: 14px;
      " title="Settings">⚙</button>
      <button id="avatar-minimize-btn" style="
        background: none; border: none; color: #aaa; cursor: pointer;
        padding: 4px 8px; border-radius: 4px; font-size: 14px;
      " title="Minimize">−</button>
      <button id="avatar-close-btn" style="
        background: none; border: none; color: #aaa; cursor: pointer;
        padding: 4px 8px; border-radius: 4px; font-size: 14px;
      " title="Close">✕</button>
    </div>
  `;
  avatarWindow.appendChild(titleBar);

  // Canvas container
  const canvasContainer = document.createElement("div");
  canvasContainer.style.cssText = `
    flex: 1;
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  `;
  avatarCanvas = document.createElement("canvas");
  avatarCanvas.style.cssText = `
    width: 100%;
    height: 100%;
    display: block;
  `;
  // Handle WebGL context loss
  avatarCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.warn("[Avatar] WebGL context lost");
  });
  avatarCanvas.addEventListener("webglcontextrestored", () => {
    console.log("[Avatar] WebGL context restored, reinitializing...");
    if (avatarCanvas && !renderer) {
      initThreeJS(avatarCanvas);
      if (vrm) {
        scene.add(vrm.scene);
      }
    }
  });
  canvasContainer.appendChild(avatarCanvas);
  avatarWindow.appendChild(canvasContainer);

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.style.cssText = `
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: se-resize;
    background: linear-gradient(-45deg, transparent 50%, rgba(255,255,255,0.1) 50%);
    z-index: 10;
  `;
  canvasContainer.appendChild(resizeHandle);

  // Settings panel (hidden by default)
  settingsPanel = createSettingsPanel();
  settingsPanel.style.display = "none";
  avatarWindow.appendChild(settingsPanel);

  // Event listeners
  setupWindowEvents(avatarWindow, titleBar, resizeHandle, canvasContainer);

  document.body.appendChild(avatarWindow);

  // Initialize Three.js
  initThreeJS(avatarCanvas);

  // Force initial resize to sync renderer/camera
  requestAnimationFrame(() => onWindowResize());

  // Subscribe to WebSocket audio for lip sync via WS.addCallback
  subscribeToWebSocketAudio();

  return avatarWindow;
}

function createSettingsPanel() {
  const panel = document.createElement("div");
  panel.id = "avatar-settings-panel";
  panel.style.cssText = `
    position: absolute;
    top: 32px;
    right: 0;
    width: 280px;
    max-height: calc(100% - 32px);
    background: rgba(15, 15, 25, 0.98);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    overflow-y: auto;
    padding: 16px;
    font-size: 12px;
    color: #eee;
    z-index: 100;
  `;

  panel.innerHTML = `
    <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <h3 style="margin: 0 0 12px; font-size: 14px;">Avatar Settings</h3>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-head-only" ${config.showHeadOnly ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Head Only Mode</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-idle" ${config.idleEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Idle Animations</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-lipsync" ${config.lipSyncEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Lip Sync</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-blink" ${config.blinkEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Auto Blink</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Head Tracking Mode</label>
      <select id="setting-head-tracking" style="width: 100%; padding: 6px; background: #1a1a2e; border: 1px solid #333; border-radius: 4px; color: #eee;">
        <option value="off" ${config.headTrackingMode === "off" ? "selected" : ""}>Off</option>
        <option value="follow" ${config.headTrackingMode === "follow" ? "selected" : ""}>Follow Face</option>
        <option value="mirror" ${config.headTrackingMode === "mirror" ? "selected" : ""}>Mirror Face</option>
      </select>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Model</label>
      <select id="setting-model" style="width: 100%; padding: 6px; background: #1a1a2e; border: 1px solid #333; border-radius: 4px; color: #eee;">
        <option value="/models/fem_vroid.vrm" ${globalConfig.modelUrl === "/models/fem_vroid.vrm" ? "selected" : ""}>Female (Vroid)</option>
        <option value="/models/masc_vroid.vrm" ${globalConfig.modelUrl === "/models/masc_vroid.vrm" ? "selected" : ""}>Male (Vroid)</option>
      </select>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Scale: <span id="scale-value">${config.scale.toFixed(2)}</span></label>
      <input type="range" id="setting-scale" min="0.5" max="3" step="0.1" value="${config.scale}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Camera Distance: <span id="cam-dist-value">${config.cameraDistance.toFixed(1)}</span></label>
      <input type="range" id="setting-cam-dist" min="1" max="10" step="0.5" value="${config.cameraDistance}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Camera Height: <span id="cam-height-value">${config.cameraHeight.toFixed(1)}</span></label>
      <input type="range" id="setting-cam-height" min="0.5" max="3" step="0.1" value="${config.cameraHeight}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Window Opacity: <span id="opacity-value">${(globalConfig.windowOpacity ?? 0.95).toFixed(2)}</span></label>
      <input type="range" id="setting-opacity" min="0.1" max="1" step="0.05" value="${globalConfig.windowOpacity ?? 0.95}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 16px;">
      <h4 style="margin: 0 0 12px; font-size: 13px;">Model Transform</h4>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position X: <span id="pos-x-value">${config.position.x.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-x" min="-2" max="2" step="0.05" value="${config.position.x}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position Y: <span id="pos-y-value">${config.position.y.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-y" min="-1" max="2" step="0.05" value="${config.position.y}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position Z: <span id="pos-z-value">${config.position.z.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-z" min="-2" max="2" step="0.05" value="${config.position.z}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Rotation Y: <span id="rot-y-value">${config.rotation.y.toFixed(2)}</span></label>
        <input type="range" id="setting-rot-y" min="-3.14" max="3.14" step="0.05" value="${config.rotation.y}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button id="face-front-btn" style="flex: 1; padding: 6px; background: #4ade80; border: none; border-radius: 4px; color: #000; cursor: pointer; font-size: 11px;">Face Front</button>
        <button id="face-back-btn" style="flex: 1; padding: 6px; background: #f87171; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 11px;">Face Back</button>
      </div>
    </div>

    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 16px;">
      <h4 style="margin: 0 0 12px; font-size: 13px;">Arm Positions</h4>
      <div id="arm-controls"></div>
    </div>

    <div id="blink-advanced" class="collapsible-section" style="margin-bottom: 16px; display: block;">
      <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 8px;" onclick="document.getElementById('blink-content').style.display = document.getElementById('blink-content').style.display === 'none' ? 'block' : 'none'; this.querySelector('.collapse-icon').textContent = document.getElementById('blink-content').style.display === 'none' ? '▶' : '▼';">
        <span>Blink Settings</span>
        <span class="collapse-icon" style="font-size: 10px;">▼</span>
      </div>
      <div id="blink-content" style="display: block;">
        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Blink Interval: <span id="blink-interval-value">${config.blinkMinInterval.toFixed(1)} - ${config.blinkMaxInterval.toFixed(1)}s</span></label>
          <div style="display: flex; gap: 8px; margin-bottom: 4px;">
            <div style="flex: 1;">
              <label style="font-size: 11px; color: #aaa;">Min</label>
              <input type="range" id="setting-blink-min" min="0.5" max="10" step="0.5" value="${config.blinkMinInterval}" style="width: 100%; accent-color: #4ade80;">
            </div>
            <div style="flex: 1;">
              <label style="font-size: 11px; color: #aaa;">Max</label>
              <input type="range" id="setting-blink-max" min="1" max="15" step="0.5" value="${config.blinkMaxInterval}" style="width: 100%; accent-color: #4ade80;">
            </div>
          </div>
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Blink Duration: <span id="blink-dur-value">${config.blinkDuration.toFixed(2)}s</span></label>
          <input type="range" id="setting-blink-dur" min="0.05" max="0.5" step="0.01" value="${config.blinkDuration}" style="width: 100%; accent-color: #4ade80;">
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Blink Hold: <span id="blink-hold-value">${config.blinkHoldDuration.toFixed(2)}s</span></label>
          <input type="range" id="setting-blink-hold" min="0.02" max="0.3" step="0.01" value="${config.blinkHoldDuration}" style="width: 100%; accent-color: #4ade80;">
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Double Blink Chance: <span id="blink-double-value">${(config.doubleBlinkChance * 100).toFixed(0)}%</span></label>
          <input type="range" id="setting-blink-double" min="0" max="1" step="0.05" value="${config.doubleBlinkChance}" style="width: 100%; accent-color: #4ade80;">
        </div>
      </div>
    </div>

    <div id="idle-advanced" class="collapsible-section" style="margin-bottom: 16px; display: block;">
      <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 8px;" onclick="document.getElementById('idle-content').style.display = document.getElementById('idle-content').style.display === 'none' ? 'block' : 'none'; this.querySelector('.collapse-icon').textContent = document.getElementById('idle-content').style.display === 'none' ? '▶' : '▼';">
        <span>Idle Animation Settings</span>
        <span class="collapse-icon" style="font-size: 10px;">▼</span>
      </div>
      <div id="idle-content" style="display: block;">
      
      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="setting-breathing" ${config.breathingEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Breathing</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Breathing Rate: <span id="breath-rate-value">${config.breathingRate.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-breath-rate" min="0.1" max="1" step="0.05" value="${config.breathingRate}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Breathing Amount: <span id="breath-amt-value">${config.breathingAmount.toFixed(3)}</span></label>
        <input type="range" id="setting-breath-amt" min="0.005" max="0.05" step="0.001" value="${config.breathingAmount}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="setting-head-sway" ${config.headSwayEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Head Sway</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway X Rate: <span id="sway-x-rate-value">${config.headSwayRateX.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-sway-x-rate" min="0.05" max="1" step="0.05" value="${config.headSwayRateX}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway X Amount: <span id="sway-x-amt-value">${config.headSwayAmountX.toFixed(3)}</span></label>
        <input type="range" id="setting-sway-x-amt" min="0.002" max="0.03" step="0.001" value="${config.headSwayAmountX}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway Y Rate: <span id="sway-y-rate-value">${config.headSwayRateY.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-sway-y-rate" min="0.05" max="1" step="0.05" value="${config.headSwayRateY}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway Y Amount: <span id="sway-y-amt-value">${config.headSwayAmountY.toFixed(3)}</span></label>
        <input type="range" id="setting-sway-y-amt" min="0.001" max="0.02" step="0.001" value="${config.headSwayAmountY}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Neck Follow Factor: <span id="neck-factor-value">${config.neckSwayFactor.toFixed(2)}</span></label>
        <input type="range" id="setting-neck-factor" min="0" max="1" step="0.05" value="${config.neckSwayFactor}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="setting-micro-move" ${config.microMovementEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Micro Movements</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Micro Movement Rate: <span id="micro-rate-value">${config.microMovementRate.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-micro-rate" min="0.01" max="0.2" step="0.01" value="${config.microMovementRate}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Micro Movement Amount: <span id="micro-amt-value">${config.microMovementAmount.toFixed(3)}</span></label>
        <input type="range" id="setting-micro-amt" min="0.001" max="0.01" step="0.001" value="${config.microMovementAmount}" style="width: 100%; accent-color: #4ade80;">
      </div>
    </div>
    </div>

    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
      <button id="reset-position-btn" style="
        width: 100%; padding: 8px; background: #333; border: 1px solid #444; 
        border-radius: 4px; color: #eee; cursor: pointer;
      ">Reset Position & Rotation</button>
    </div>
  `;

  // Populate arm controls
  setTimeout(() => populateArmControls(panel), 0);

  // Event listeners for settings
  setupSettingsEvents(panel);

  return panel;
}

function populateArmControls(panel) {
  const container = panel.querySelector("#arm-controls");
  if (!container) return;

  const bones = [
    { key: "leftShoulder", label: "Left Shoulder" },
    { key: "leftUpperArm", label: "Left Upper Arm" },
    { key: "leftLowerArm", label: "Left Lower Arm" },
    { key: "rightShoulder", label: "Right Shoulder" },
    { key: "rightUpperArm", label: "Right Upper Arm" },
    { key: "rightLowerArm", label: "Right Lower Arm" },
  ];

  bones.forEach((bone) => {
    const group = document.createElement("div");
    group.style.marginBottom = "12px";
    group.innerHTML = `<strong style="font-size: 11px; color: #aaa;">${bone.label}</strong>`;
    
    ["x", "y", "z"].forEach((axis) => {
      const value = config.armPositions[bone.key]?.[axis] || 0;
      
      const sliderDiv = document.createElement("div");
      sliderDiv.style.marginTop = "4px";
      sliderDiv.innerHTML = `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
          <span style="width: 12px;">${axis.toUpperCase()}</span>
          <input type="range" data-bone="${bone.key}" data-axis="${axis}" min="-3.14" max="3.14" step="0.05" value="${value}" style="flex: 1; accent-color: #4ade80;">
          <span style="width: 40px; text-align: right;" class="arm-value-${bone.key}${axis.toUpperCase()}">${value.toFixed(2)}</span>
        </label>
      `;
      group.appendChild(sliderDiv);
    });
    
    container.appendChild(group);
  });
}

function setupSettingsEvents(panel) {
  // Head only
  panel.querySelector("#setting-head-only").addEventListener("change", (e) => {
    config.showHeadOnly = e.target.checked;
    saveConfig();
    updateHeadOnlyMode();
  });

  // Idle animations
  panel.querySelector("#setting-idle").addEventListener("change", (e) => {
    config.idleEnabled = e.target.checked;
    // Reset idle time when toggled to avoid jump
    if (config.idleEnabled) {
      idleTime = 0;
    }
    saveConfig();
  });

  // Lip sync
  panel.querySelector("#setting-lipsync").addEventListener("change", (e) => {
    config.lipSyncEnabled = e.target.checked;
    saveConfig();
  });

  // Blink
  panel.querySelector("#setting-blink").addEventListener("change", (e) => {
    config.blinkEnabled = e.target.checked;
    // Reset blink state when toggled
    if (config.blinkEnabled) {
      blinkTimer = 0;
      blinkState = 0;
      nextBlinkTime = THREE.MathUtils.lerp(config.blinkMinInterval, config.blinkMaxInterval, Math.random());
      isDoubleBlink = false;
    } else {
      setBlinkWeight(0); // Ensure eyes are open
    }
    saveConfig();
  });

  // Blink min interval
  panel.querySelector("#setting-blink-min").addEventListener("input", (e) => {
    config.blinkMinInterval = parseFloat(e.target.value);
    panel.querySelector("#blink-interval-value").textContent = `${config.blinkMinInterval.toFixed(1)} - ${config.blinkMaxInterval.toFixed(1)}s`;
  });
  panel.querySelector("#setting-blink-min").addEventListener("change", () => saveConfig());

  // Blink max interval
  panel.querySelector("#setting-blink-max").addEventListener("input", (e) => {
    config.blinkMaxInterval = parseFloat(e.target.value);
    panel.querySelector("#blink-interval-value").textContent = `${config.blinkMinInterval.toFixed(1)} - ${config.blinkMaxInterval.toFixed(1)}s`;
  });
  panel.querySelector("#setting-blink-max").addEventListener("change", () => saveConfig());

  // Blink duration
  panel.querySelector("#setting-blink-dur").addEventListener("input", (e) => {
    config.blinkDuration = parseFloat(e.target.value);
    panel.querySelector("#blink-dur-value").textContent = `${config.blinkDuration.toFixed(2)}s`;
  });
  panel.querySelector("#setting-blink-dur").addEventListener("change", () => saveConfig());

  // Blink hold duration
  panel.querySelector("#setting-blink-hold").addEventListener("input", (e) => {
    config.blinkHoldDuration = parseFloat(e.target.value);
    panel.querySelector("#blink-hold-value").textContent = `${config.blinkHoldDuration.toFixed(2)}s`;
  });
  panel.querySelector("#setting-blink-hold").addEventListener("change", () => saveConfig());

  // Double blink chance
  panel.querySelector("#setting-blink-double").addEventListener("input", (e) => {
    config.doubleBlinkChance = parseFloat(e.target.value);
    panel.querySelector("#blink-double-value").textContent = `${(config.doubleBlinkChance * 100).toFixed(0)}%`;
  });
  panel.querySelector("#setting-blink-double").addEventListener("change", () => saveConfig());

  // Breathing toggle
  panel.querySelector("#setting-breathing").addEventListener("change", (e) => {
    config.breathingEnabled = e.target.checked;
    saveConfig();
  });

  // Breathing rate
  panel.querySelector("#setting-breath-rate").addEventListener("input", (e) => {
    config.breathingRate = parseFloat(e.target.value);
    panel.querySelector("#breath-rate-value").textContent = `${config.breathingRate.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-breath-rate").addEventListener("change", () => saveConfig());

  // Breathing amount
  panel.querySelector("#setting-breath-amt").addEventListener("input", (e) => {
    config.breathingAmount = parseFloat(e.target.value);
    panel.querySelector("#breath-amt-value").textContent = config.breathingAmount.toFixed(3);
  });
  panel.querySelector("#setting-breath-amt").addEventListener("change", () => saveConfig());

  // Head sway toggle
  panel.querySelector("#setting-head-sway").addEventListener("change", (e) => {
    config.headSwayEnabled = e.target.checked;
    saveConfig();
  });

  // Head sway X rate
  panel.querySelector("#setting-sway-x-rate").addEventListener("input", (e) => {
    config.headSwayRateX = parseFloat(e.target.value);
    panel.querySelector("#sway-x-rate-value").textContent = `${config.headSwayRateX.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-sway-x-rate").addEventListener("change", () => saveConfig());

  // Head sway X amount
  panel.querySelector("#setting-sway-x-amt").addEventListener("input", (e) => {
    config.headSwayAmountX = parseFloat(e.target.value);
    panel.querySelector("#sway-x-amt-value").textContent = config.headSwayAmountX.toFixed(3);
  });
  panel.querySelector("#setting-sway-x-amt").addEventListener("change", () => saveConfig());

  // Head sway Y rate
  panel.querySelector("#setting-sway-y-rate").addEventListener("input", (e) => {
    config.headSwayRateY = parseFloat(e.target.value);
    panel.querySelector("#sway-y-rate-value").textContent = `${config.headSwayRateY.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-sway-y-rate").addEventListener("change", () => saveConfig());

  // Head sway Y amount
  panel.querySelector("#setting-sway-y-amt").addEventListener("input", (e) => {
    config.headSwayAmountY = parseFloat(e.target.value);
    panel.querySelector("#sway-y-amt-value").textContent = config.headSwayAmountY.toFixed(3);
  });
  panel.querySelector("#setting-sway-y-amt").addEventListener("change", () => saveConfig());

  // Neck follow factor
  panel.querySelector("#setting-neck-factor").addEventListener("input", (e) => {
    config.neckSwayFactor = parseFloat(e.target.value);
    panel.querySelector("#neck-factor-value").textContent = config.neckSwayFactor.toFixed(2);
  });
  panel.querySelector("#setting-neck-factor").addEventListener("change", () => saveConfig());

  // Micro movement toggle
  panel.querySelector("#setting-micro-move").addEventListener("change", (e) => {
    config.microMovementEnabled = e.target.checked;
    saveConfig();
  });

  // Micro movement rate
  panel.querySelector("#setting-micro-rate").addEventListener("input", (e) => {
    config.microMovementRate = parseFloat(e.target.value);
    panel.querySelector("#micro-rate-value").textContent = `${config.microMovementRate.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-micro-rate").addEventListener("change", () => saveConfig());

  // Micro movement amount
  panel.querySelector("#setting-micro-amt").addEventListener("input", (e) => {
    config.microMovementAmount = parseFloat(e.target.value);
    panel.querySelector("#micro-amt-value").textContent = config.microMovementAmount.toFixed(3);
  });
  panel.querySelector("#setting-micro-amt").addEventListener("change", () => saveConfig());

  // Head tracking
  panel.querySelector("#setting-head-tracking").addEventListener("change", (e) => {
    initHeadTracking(e.target.value);
  });

  // Model
  panel.querySelector("#setting-model").addEventListener("change", async (e) => {
    const newModelUrl = e.target.value;
    if (!newModelUrl) {
      console.warn("[Avatar] Invalid model URL selected");
      return;
    }
    globalConfig.modelUrl = newModelUrl;
    saveConfig();
    await loadVRM(globalConfig.modelUrl);
  });

  // Scale
  panel.querySelector("#setting-scale").addEventListener("input", (e) => {
    config.scale = parseFloat(e.target.value);
    panel.querySelector("#scale-value").textContent = config.scale.toFixed(2);
    if (vrm) vrm.scene.scale.setScalar(config.scale);
  });
  panel.querySelector("#setting-scale").addEventListener("change", () => saveConfig());

  // Camera distance
  panel.querySelector("#setting-cam-dist").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#cam-dist-value").textContent = value.toFixed(1);
    if (config.showHeadOnly) {
      config.headOnlyCameraDistance = value;
    } else {
      config.cameraDistance = value;
    }
    if (camera && controls) {
      // Update camera position based on current spherical coordinates
      const target = config.showHeadOnly ? config.headOnlyCameraTarget : config.cameraTarget;
      const azimuth = config.showHeadOnly ? config.headOnlyCameraAzimuth : config.cameraAzimuth;
      const polar = config.showHeadOnly ? config.headOnlyCameraPolar : config.cameraPolar;
      const sinPolar = Math.sin(polar);
      camera.position.set(
        target.x + value * sinPolar * Math.sin(azimuth),
        target.y + value * Math.cos(polar),
        target.z + value * sinPolar * Math.cos(azimuth)
      );
    }
  });
  panel.querySelector("#setting-cam-dist").addEventListener("change", () => saveConfig());

  // Camera height
  panel.querySelector("#setting-cam-height").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#cam-height-value").textContent = value.toFixed(1);
    if (config.showHeadOnly) {
      config.headOnlyCameraHeight = value;
    } else {
      config.cameraHeight = value;
    }
    if (camera && controls) {
      // Update camera position based on current spherical coordinates
      const target = config.showHeadOnly ? config.headOnlyCameraTarget : config.cameraTarget;
      const azimuth = config.showHeadOnly ? config.headOnlyCameraAzimuth : config.cameraAzimuth;
      const polar = config.showHeadOnly ? config.headOnlyCameraPolar : config.cameraPolar;
      const distance = config.showHeadOnly ? config.headOnlyCameraDistance : config.cameraDistance;
      const sinPolar = Math.sin(polar);
      camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      camera.lookAt(target.x, target.y, target.z);
    }
  });
  panel.querySelector("#setting-cam-height").addEventListener("change", () => saveConfig());

  // Window opacity (global setting)
  panel.querySelector("#setting-opacity").addEventListener("input", (e) => {
    globalConfig.windowOpacity = parseFloat(e.target.value);
    panel.querySelector("#opacity-value").textContent = globalConfig.windowOpacity.toFixed(2);
    if (avatarWindow) {
      avatarWindow.style.background = `rgba(20, 20, 30, ${globalConfig.windowOpacity})`;
    }
    // Scene background is transparent (null), so canvas alpha shows window background
    // No need to set scene.backgroundAlpha
  });
  panel.querySelector("#setting-opacity").addEventListener("change", () => saveConfig());

  // Arm sliders
  panel.querySelectorAll("input[data-bone]").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const boneKey = e.target.dataset.bone;
      const axis = e.target.dataset.axis;
      const value = parseFloat(e.target.value);
      config.armPositions[boneKey] = config.armPositions[boneKey] || {};
      config.armPositions[boneKey][axis] = value;
      panel.querySelector(`.arm-value-${boneKey}${axis.toUpperCase()}`).textContent = value.toFixed(2);
      setArmPosition(boneKey, 
        config.armPositions[boneKey].x || 0, 
        config.armPositions[boneKey].y || 0, 
        config.armPositions[boneKey].z || 0);
    });
    slider.addEventListener("change", () => saveConfig());
  });

  // Model position X
  panel.querySelector("#setting-pos-x").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-x-value").textContent = value.toFixed(2);
    if (config.showHeadOnly) {
      config.headOnlyPosition.x = value;
      targetPosition.x = value;
    } else {
      config.position.x = value;
      targetPosition.x = value;
    }
    if (vrm) vrm.scene.position.x = value;
  });
  panel.querySelector("#setting-pos-x").addEventListener("change", () => saveConfig());

  // Model position Y
  panel.querySelector("#setting-pos-y").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-y-value").textContent = value.toFixed(2);
    if (config.showHeadOnly) {
      config.headOnlyPosition.y = value;
      targetPosition.y = value;
    } else {
      config.position.y = value;
      targetPosition.y = value;
    }
    if (vrm) vrm.scene.position.y = value;
  });
  panel.querySelector("#setting-pos-y").addEventListener("change", () => saveConfig());

  // Model position Z
  panel.querySelector("#setting-pos-z").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-z-value").textContent = value.toFixed(2);
    if (config.showHeadOnly) {
      config.headOnlyPosition.z = value;
      targetPosition.z = value;
    } else {
      config.position.z = value;
      targetPosition.z = value;
    }
    if (vrm) vrm.scene.position.z = value;
  });
  panel.querySelector("#setting-pos-z").addEventListener("change", () => saveConfig());

  // Model rotation Y
  panel.querySelector("#setting-rot-y").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    if (config.showHeadOnly) {
      config.headOnlyRotation.y = value;
      targetRotation.y = value;
    } else {
      config.rotation.y = value;
      targetRotation.y = value;
    }
    if (vrm) vrm.scene.rotation.y = value;
  });
  panel.querySelector("#setting-rot-y").addEventListener("change", () => saveConfig());

  // Face front button
  panel.querySelector("#face-front-btn").addEventListener("click", () => {
    const value = Math.PI;
    if (config.showHeadOnly) {
      config.headOnlyRotation.y = value;
      targetRotation.y = value;
    } else {
      config.rotation.y = value;
      targetRotation.y = value;
    }
    if (vrm) vrm.scene.rotation.y = value;
    panel.querySelector("#setting-rot-y").value = value;
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    saveConfig();
  });

  // Face back button
  panel.querySelector("#face-back-btn").addEventListener("click", () => {
    const value = 0;
    if (config.showHeadOnly) {
      config.headOnlyRotation.y = value;
      targetRotation.y = value;
    } else {
      config.rotation.y = value;
      targetRotation.y = value;
    }
    if (vrm) vrm.scene.rotation.y = value;
    panel.querySelector("#setting-rot-y").value = value;
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    saveConfig();
  });

  // Reset position
  panel.querySelector("#reset-position-btn").addEventListener("click", () => {
    if (config.showHeadOnly) {
      config.headOnlyPosition = { x: 0, y: 0, z: 0 };
      config.headOnlyRotation = { x: 0, y: Math.PI, z: 0 };
      targetPosition.set(0, 0, 0);
      targetRotation.set(0, Math.PI, 0);
      if (vrm) {
        vrm.scene.position.set(0, 0, 0);
        vrm.scene.rotation.set(0, Math.PI, 0);
      }
    } else {
      config.position = { x: 0, y: 0, z: 0 };
      config.rotation = { x: 0, y: Math.PI, z: 0 }; // Face front by default
      targetPosition.set(0, 0, 0);
      targetRotation.set(0, Math.PI, 0);
      if (vrm) {
        vrm.scene.position.set(0, 0, 0);
        vrm.scene.rotation.set(0, Math.PI, 0);
      }
      if (controls) controls.target.set(0, config.cameraHeight * 0.8, 0);
    }
    // Update UI
    const posXSlider = panel.querySelector("#setting-pos-x");
    const posYSlider = panel.querySelector("#setting-pos-y");
    const posZSlider = panel.querySelector("#setting-pos-z");
    const rotYSlider = panel.querySelector("#setting-rot-y");
    if (posXSlider) { posXSlider.value = 0; panel.querySelector("#pos-x-value").textContent = "0.00"; }
    if (posYSlider) { posYSlider.value = 0; panel.querySelector("#pos-y-value").textContent = "0.00"; }
    if (posZSlider) { posZSlider.value = 0; panel.querySelector("#pos-z-value").textContent = "0.00"; }
    if (rotYSlider) { rotYSlider.value = Math.PI; panel.querySelector("#rot-y-value").textContent = Math.PI.toFixed(2); }
    saveConfig();
  });
}

function setupWindowEvents(win, titleBar, resizeHandle, canvasContainer) {
  // Dragging window
  let isMoving = false;
  let moveOffsetX = 0;
  let moveOffsetY = 0;

  titleBar.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    isMoving = true;
    moveOffsetX = e.clientX - win.offsetLeft;
    moveOffsetY = e.clientY - win.offsetTop;
    win.style.zIndex = String(Number(win.style.zIndex || 10000) + 1);
  });

  document.addEventListener("mousemove", (e) => {
    if (!isMoving) return;
    win.style.left = `${e.clientX - moveOffsetX}px`;
    win.style.top = `${e.clientY - moveOffsetY}px`;
    globalConfig.windowBounds.x = e.clientX - moveOffsetX;
    globalConfig.windowBounds.y = e.clientY - moveOffsetY;
  });

  document.addEventListener("mouseup", () => {
    if (isMoving) {
      isMoving = false;
      saveConfig();
    }
  });

  // Resizing
  let isResizing = false;
  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(300, e.clientX - win.offsetLeft);
    const newHeight = Math.max(200, e.clientY - win.offsetTop);
    win.style.width = `${newWidth}px`;
    win.style.height = `${newHeight}px`;
    globalConfig.windowBounds.width = newWidth;
    globalConfig.windowBounds.height = newHeight;
    // Let flex layout handle canvasContainer sizing - schedule resize (debounced)
    scheduleResize();
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      saveConfig();
      scheduleResize();
    }
  });

  // Buttons
  win.querySelector("#avatar-close-btn").addEventListener("click", () => {
    window.Avatar.stop();
    win.remove();
    avatarWindow = null;
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  win.querySelector("#avatar-minimize-btn").addEventListener("click", () => {
    const isMinimized = canvasContainer.style.display === "none";
    canvasContainer.style.display = isMinimized ? "flex" : "none";
    resizeHandle.style.display = isMinimized ? "block" : "none";
    win.style.height = isMinimized ? `${globalConfig.windowBounds.height}px` : "32px";
    // Trigger resize after maximize
    if (isMinimized) {
      scheduleResize();
    }
  });

  win.querySelector("#avatar-settings-btn").addEventListener("click", () => {
    isSettingsOpen = !isSettingsOpen;
    settingsPanel.style.display = isSettingsOpen ? "block" : "none";
    if (isSettingsOpen) {
      updateSettingsPanel();
    }
  });

  // Close settings when clicking outside
  document.addEventListener("mousedown", (e) => {
    if (isSettingsOpen && !settingsPanel.contains(e.target) && e.target.id !== "avatar-settings-btn") {
      isSettingsOpen = false;
      settingsPanel.style.display = "none";
    }
  });
}

let resizeFrameId = null;
let lastKnownSize = { width: 0, height: 0, pixelRatio: 0 };

function onWindowResize() {
  if (!avatarCanvas || !renderer || !camera) return;
  
  // Get size from canvasContainer (the flex child that actually resizes)
  const canvasContainer = avatarCanvas.parentElement;
  if (!canvasContainer) {
    console.warn("[Avatar] onWindowResize: no canvasContainer");
    return;
  }
  
  const width = canvasContainer.clientWidth;
  const height = canvasContainer.clientHeight;
  
  if (width === 0 || height === 0) {
    // Canvas might be hidden/minimized, skip resize
    return;
  }
  
  // Use device pixel ratio (capped for performance)
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  
  // Check if size actually changed (avoid unnecessary GPU work)
  // Compare CSS size + pixelRatio, not drawing buffer
  if (lastKnownSize.width === width && 
      lastKnownSize.height === height && 
      lastKnownSize.pixelRatio === pixelRatio) {
    return; // No actual change
  }
  
  lastKnownSize = { width, height, pixelRatio };
  
  // Let three.js handle drawing buffer via pixelRatio
  // Don't manually set canvas.width/height - renderer.setSize + setPixelRatio does it correctly
  renderer.setSize(width, height, false); // false = don't update CSS style (flex handles it)
  renderer.setPixelRatio(pixelRatio);
  
  // Update camera aspect to match CSS aspect ratio (not drawing buffer)
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  
  const drawingWidth = Math.floor(width * pixelRatio);
  const drawingHeight = Math.floor(height * pixelRatio);
  console.log("[Avatar] Resize:", width, "x", height, "@", pixelRatio, "=>", drawingWidth, "x", drawingHeight);
}

// Debounced resize handler for ResizeObserver (avoids excessive calls during drag)
function scheduleResize() {
  if (resizeFrameId) return;
  resizeFrameId = requestAnimationFrame(() => {
    resizeFrameId = null;
    onWindowResize();
  });
}

// ============ Public API ============
window.Avatar = {
  init: createAvatarWindow,
  loadModel: loadVRM,
  setAudioElement: setupAudioAnalysis,
  setConfig: (newConfig) => {
    config = deepMerge(config, newConfig);
    saveConfig();
    applyConfig();
  },
  getConfig: () => ({ ...config }),
  show: () => {
    if (avatarWindow) avatarWindow.style.display = "flex";
  },
  hide: () => {
    if (avatarWindow) avatarWindow.style.display = "none";
  },
  stop: () => {
    if (animationId) cancelAnimationFrame(animationId);
    stopHeadTracking();
    // Cleanup WebSocket audio callback (WS.addCallback doesn't return unsubscribe)
    wsAudioCallbackId = null;
    if (mixer) {
      mixer.uncacheRoot(vrm?.scene);
      mixer = null;
    }
    if (vrm) {
      scene.remove(vrm.scene);
      vrm = null;
    }
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    // Cleanup audio context
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;
    waveformAnalyser = null;
    audioSource = null;
    mediaElement = null;
  },
  clear: () => {
    window.Avatar.stop();
    if (avatarWindow) {
      avatarWindow.remove();
      avatarWindow = null;
    }
  },
  speak: (audioElement) => {
    setupAudioAnalysis(audioElement);
  },
};

function applyConfig() {
  if (vrm) {
    // Apply position/rotation based on head-only mode
    if (config.showHeadOnly) {
      vrm.scene.scale.setScalar(config.scale);
      vrm.scene.position.set(config.headOnlyPosition.x, config.headOnlyPosition.y, config.headOnlyPosition.z);
      vrm.scene.rotation.set(config.headOnlyRotation.x, config.headOnlyRotation.y, config.headOnlyRotation.z);
      targetRotation.set(config.headOnlyRotation.x, config.headOnlyRotation.y, config.headOnlyRotation.z);
      targetPosition.set(config.headOnlyPosition.x, config.headOnlyPosition.y, config.headOnlyPosition.z);
    } else {
      vrm.scene.scale.setScalar(config.scale);
      vrm.scene.position.set(config.position.x, config.position.y, config.position.z);
      vrm.scene.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
      targetRotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
      targetPosition.set(config.position.x, config.position.y, config.position.z);
    }
    updateHeadOnlyMode();
    applyArmPositions();
  }
  if (camera && controls) {
    // Restore camera state based on head-only mode
    let distance, azimuth, polar, target;
    
    if (config.showHeadOnly) {
      distance = config.headOnlyCameraDistance ?? 2.5;
      azimuth = config.headOnlyCameraAzimuth ?? 0;
      polar = config.headOnlyCameraPolar ?? Math.PI / 3;
      target = config.headOnlyCameraTarget ?? { x: 0, y: 1.6, z: 0 };
    } else {
      distance = config.cameraDistance ?? 3;
      azimuth = config.cameraAzimuth ?? 0;
      polar = config.cameraPolar ?? Math.PI / 3;
      target = config.cameraTarget ?? { x: 0, y: config.cameraHeight * 0.8, z: 0 };
    }

    // Set controls target first (pan position)
    controls.target.set(target.x, target.y, target.z);

    // Calculate camera position from spherical coordinates
    const sinPolar = Math.sin(polar);
    camera.position.set(
      target.x + distance * sinPolar * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * sinPolar * Math.cos(azimuth)
    );
    camera.lookAt(target.x, target.y, target.z);
    
    // Update controls to match
    controls.update();
  }
}

function updateSettingsPanel() {
  if (!settingsPanel) return;
  
  // Update checkboxes
  const headOnlyCb = settingsPanel.querySelector("#setting-head-only");
  if (headOnlyCb) headOnlyCb.checked = config.showHeadOnly;
  
  const idleCb = settingsPanel.querySelector("#setting-idle");
  if (idleCb) idleCb.checked = config.idleEnabled;
  
  const lipsyncCb = settingsPanel.querySelector("#setting-lipsync");
  if (lipsyncCb) lipsyncCb.checked = config.lipSyncEnabled;
  
  const blinkCb = settingsPanel.querySelector("#setting-blink");
  if (blinkCb) blinkCb.checked = config.blinkEnabled;
  
  // Blink settings
  const blinkMinSlider = settingsPanel.querySelector("#setting-blink-min");
  if (blinkMinSlider) {
    blinkMinSlider.value = config.blinkMinInterval;
    const blinkIntervalVal = settingsPanel.querySelector("#blink-interval-value");
    if (blinkIntervalVal) blinkIntervalVal.textContent = `${config.blinkMinInterval.toFixed(1)} - ${config.blinkMaxInterval.toFixed(1)}s`;
  }
  const blinkMaxSlider = settingsPanel.querySelector("#setting-blink-max");
  if (blinkMaxSlider) {
    blinkMaxSlider.value = config.blinkMaxInterval;
    const blinkIntervalVal = settingsPanel.querySelector("#blink-interval-value");
    if (blinkIntervalVal) blinkIntervalVal.textContent = `${config.blinkMinInterval.toFixed(1)} - ${config.blinkMaxInterval.toFixed(1)}s`;
  }
  const blinkDurSlider = settingsPanel.querySelector("#setting-blink-dur");
  if (blinkDurSlider) {
    blinkDurSlider.value = config.blinkDuration;
    const blinkDurVal = settingsPanel.querySelector("#blink-dur-value");
    if (blinkDurVal) blinkDurVal.textContent = `${config.blinkDuration.toFixed(2)}s`;
  }
  const blinkHoldSlider = settingsPanel.querySelector("#setting-blink-hold");
  if (blinkHoldSlider) {
    blinkHoldSlider.value = config.blinkHoldDuration;
    const blinkHoldVal = settingsPanel.querySelector("#blink-hold-value");
    if (blinkHoldVal) blinkHoldVal.textContent = `${config.blinkHoldDuration.toFixed(2)}s`;
  }
  const blinkDoubleSlider = settingsPanel.querySelector("#setting-blink-double");
  if (blinkDoubleSlider) {
    blinkDoubleSlider.value = config.doubleBlinkChance;
    const blinkDoubleVal = settingsPanel.querySelector("#blink-double-value");
    if (blinkDoubleVal) blinkDoubleVal.textContent = `${(config.doubleBlinkChance * 100).toFixed(0)}%`;
  }
  
  // Breathing
  const breathingCb = settingsPanel.querySelector("#setting-breathing");
  if (breathingCb) breathingCb.checked = config.breathingEnabled;
  const breathRateSlider = settingsPanel.querySelector("#setting-breath-rate");
  if (breathRateSlider) {
    breathRateSlider.value = config.breathingRate;
    const breathRateVal = settingsPanel.querySelector("#breath-rate-value");
    if (breathRateVal) breathRateVal.textContent = `${config.breathingRate.toFixed(2)} Hz`;
  }
  const breathAmtSlider = settingsPanel.querySelector("#setting-breath-amt");
  if (breathAmtSlider) {
    breathAmtSlider.value = config.breathingAmount;
    const breathAmtVal = settingsPanel.querySelector("#breath-amt-value");
    if (breathAmtVal) breathAmtVal.textContent = config.breathingAmount.toFixed(3);
  }
  
  // Head sway
  const headSwayCb = settingsPanel.querySelector("#setting-head-sway");
  if (headSwayCb) headSwayCb.checked = config.headSwayEnabled;
  const swayXRateSlider = settingsPanel.querySelector("#setting-sway-x-rate");
  if (swayXRateSlider) {
    swayXRateSlider.value = config.headSwayRateX;
    const swayXRateVal = settingsPanel.querySelector("#sway-x-rate-value");
    if (swayXRateVal) swayXRateVal.textContent = `${config.headSwayRateX.toFixed(2)} Hz`;
  }
  const swayXAmtSlider = settingsPanel.querySelector("#setting-sway-x-amt");
  if (swayXAmtSlider) {
    swayXAmtSlider.value = config.headSwayAmountX;
    const swayXAmtVal = settingsPanel.querySelector("#sway-x-amt-value");
    if (swayXAmtVal) swayXAmtVal.textContent = config.headSwayAmountX.toFixed(3);
  }
  const swayYRateSlider = settingsPanel.querySelector("#setting-sway-y-rate");
  if (swayYRateSlider) {
    swayYRateSlider.value = config.headSwayRateY;
    const swayYRateVal = settingsPanel.querySelector("#sway-y-rate-value");
    if (swayYRateVal) swayYRateVal.textContent = `${config.headSwayRateY.toFixed(2)} Hz`;
  }
  const swayYAmtSlider = settingsPanel.querySelector("#setting-sway-y-amt");
  if (swayYAmtSlider) {
    swayYAmtSlider.value = config.headSwayAmountY;
    const swayYAmtVal = settingsPanel.querySelector("#sway-y-amt-value");
    if (swayYAmtVal) swayYAmtVal.textContent = config.headSwayAmountY.toFixed(3);
  }
  const neckFactorSlider = settingsPanel.querySelector("#setting-neck-factor");
  if (neckFactorSlider) {
    neckFactorSlider.value = config.neckSwayFactor;
    const neckFactorVal = settingsPanel.querySelector("#neck-factor-value");
    if (neckFactorVal) neckFactorVal.textContent = config.neckSwayFactor.toFixed(2);
  }
  
  // Micro movements
  const microMoveCb = settingsPanel.querySelector("#setting-micro-move");
  if (microMoveCb) microMoveCb.checked = config.microMovementEnabled;
  const microRateSlider = settingsPanel.querySelector("#setting-micro-rate");
  if (microRateSlider) {
    microRateSlider.value = config.microMovementRate;
    const microRateVal = settingsPanel.querySelector("#micro-rate-value");
    if (microRateVal) microRateVal.textContent = `${config.microMovementRate.toFixed(2)} Hz`;
  }
  const microAmtSlider = settingsPanel.querySelector("#setting-micro-amt");
  if (microAmtSlider) {
    microAmtSlider.value = config.microMovementAmount;
    const microAmtVal = settingsPanel.querySelector("#micro-amt-value");
    if (microAmtVal) microAmtVal.textContent = config.microMovementAmount.toFixed(3);
  }
  
  // Update selects
  const headTrackingSel = settingsPanel.querySelector("#setting-head-tracking");
  if (headTrackingSel) headTrackingSel.value = config.headTrackingMode;
  
  const modelSel = settingsPanel.querySelector("#setting-model");
  if (modelSel) modelSel.value = globalConfig.modelUrl;
  
  // Update sliders
  const scaleSlider = settingsPanel.querySelector("#setting-scale");
  if (scaleSlider) {
    scaleSlider.value = config.scale;
    const scaleVal = settingsPanel.querySelector("#scale-value");
    if (scaleVal) scaleVal.textContent = config.scale.toFixed(2);
  }
  
  // Camera settings - use head-only config when in head-only mode
  const camConfig = config.showHeadOnly 
    ? { distance: config.headOnlyCameraDistance, height: config.headOnlyCameraHeight }
    : { distance: config.cameraDistance, height: config.cameraHeight };
  
  const camDistSlider = settingsPanel.querySelector("#setting-cam-dist");
  if (camDistSlider) {
    camDistSlider.value = camConfig.distance;
    const camDistVal = settingsPanel.querySelector("#cam-dist-value");
    if (camDistVal) camDistVal.textContent = camConfig.distance.toFixed(1);
  }
  
  const camHeightSlider = settingsPanel.querySelector("#setting-cam-height");
  if (camHeightSlider) {
    camHeightSlider.value = camConfig.height;
    const camHeightVal = settingsPanel.querySelector("#cam-height-value");
    if (camHeightVal) camHeightVal.textContent = camConfig.height.toFixed(1);
  }
  
  // Update arm sliders
  settingsPanel.querySelectorAll("input[data-bone]").forEach((slider) => {
    const boneKey = slider.dataset.bone;
    const axis = slider.dataset.axis;
    const value = config.armPositions[boneKey]?.[axis] || 0;
    slider.value = value;
    const valSpan = settingsPanel.querySelector(`.arm-value-${boneKey}${axis.toUpperCase()}`);
    if (valSpan) valSpan.textContent = value.toFixed(2);
  });

  // Update model position/rotation sliders (use head-only config when in head-only mode)
  const posConfig = config.showHeadOnly ? config.headOnlyPosition : config.position;
  const rotConfig = config.showHeadOnly ? config.headOnlyRotation : config.rotation;
  
  const posXSlider = settingsPanel.querySelector("#setting-pos-x");
  if (posXSlider) {
    posXSlider.value = posConfig.x;
    const posXVal = settingsPanel.querySelector("#pos-x-value");
    if (posXVal) posXVal.textContent = posConfig.x.toFixed(2);
  }
  const posYSlider = settingsPanel.querySelector("#setting-pos-y");
  if (posYSlider) {
    posYSlider.value = posConfig.y;
    const posYVal = settingsPanel.querySelector("#pos-y-value");
    if (posYVal) posYVal.textContent = posConfig.y.toFixed(2);
  }
  const posZSlider = settingsPanel.querySelector("#setting-pos-z");
  if (posZSlider) {
    posZSlider.value = posConfig.z;
    const posZVal = settingsPanel.querySelector("#pos-z-value");
    if (posZVal) posZVal.textContent = posConfig.z.toFixed(2);
  }
  const rotYSlider = settingsPanel.querySelector("#setting-rot-y");
  if (rotYSlider) {
    rotYSlider.value = rotConfig.y;
    const rotYVal = settingsPanel.querySelector("#rot-y-value");
    if (rotYVal) rotYVal.textContent = rotConfig.y.toFixed(2);
  }
}

// ============ WebSocket Audio Integration ============
// Use WS.addCallback to receive raw audio buffers directly for lip sync
let wsAudioCallbackId = null;

function subscribeToWebSocketAudio() {
  // Remove previous callback if any
  if (wsAudioCallbackId !== null) {
    wsAudioCallbackId = null;
  }

  if (typeof WS !== "undefined" && typeof WS.addCallback === "function") {
    wsAudioCallbackId = WS.addCallback((data, isBinary, type) => {
      // Handle binary audio data (WAV/MP3) - use as trigger to hook into existing audio element
      if (isBinary && type && type.startsWith("audio")) {
        console.log("[Avatar] Audio received via WS, hooking into #audio element for lip sync");
        // Small delay to let websockethandler create the <audio> element
        setTimeout(() => {
          const audioEl = document.getElementById("audio");
          if (audioEl && audioEl !== mediaElement) {
            setupAudioAnalysis(audioEl);
          }
        }, 50);
      }
    });
    console.log("[Avatar] Registered WS.addCallback for audio lip sync");
  } else {
    // WS not ready yet, retry after a short delay
    setTimeout(subscribeToWebSocketAudio, 500);
  }
}

// Auto-initialize if avatar container exists
document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
});

// Keyboard shortcut: 'A' key to toggle avatar window
document.addEventListener("keydown", (e) => {
  if (e.key === "a" || e.key === "A") {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      if (window.Avatar) {
        if (document.getElementById("avatar-window")) {
          window.Avatar.hide();
        } else {
          window.Avatar.init();
        }
      }
    }
  }
});

// Export for module usage
export { createAvatarWindow, loadVRM, setupAudioAnalysis, config as avatarConfig };
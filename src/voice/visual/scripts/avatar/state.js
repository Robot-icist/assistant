import * as THREE from "three";

// Shared mutable state for the avatar system.
// All modules import this object and read/write its properties.
export const state = {
  // Face Mesh
  faceMesh: null,
  faceMeshLoaded: false,
  faceMeshLoadPromise: null,

  // Config
  AVATAR_CONFIG_KEY: "vrm_avatar_config",

  // Three.js scene
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  mixer: null,
  vrm: null,
  clock: new THREE.Clock(),
  frameCount: 0,
  lastLogTime: performance.now(),

  // Audio
  audioContext: null,
  analyser: null,
  audioSource: null,
  mediaElement: null,
  waveformAnalyser: null,

  // Lip sync
  lipSyncData: { vowels: { a: 0, i: 0, u: 0, e: 0, o: 0 }, silence: 0 },
  targetMorphTargets: { a: 0, i: 0, u: 0, e: 0, o: 0 },
  currentMorphTargets: { a: 0, i: 0, u: 0, e: 0, o: 0 },
  lastPhonemeScores: { a: 0, i: 0, u: 0, e: 0, o: 0, bilabial: 0, dental: 0, velar: 0, fricative: 0 },
  phonemeHistory: [],
  lipSyncWorker: null,
  audioWorkletNode: null,

  // Idle animation
  idleTime: 0,
  blinkTimer: 0,
  blinkState: 0,
  nextBlinkTime: Math.random() * 3 + 2,
  isDoubleBlink: false,

  // Head tracking
  videoElement: null,
  previewCanvas: null,
  previewContext: null,
  headTrackingActive: false,
  headTrackingState: {
    yaw: 0,
    pitch: 0,
    roll: 0,
    leftEyeOpenness: 1,
    rightEyeOpenness: 1,
    mouthOpenness: 0,
    mouthWidth: 0,
  },
  currentVoiceActivity: 0,
  faceDetected: false,
  faceMeshResults: null,
  faceMeshCanvas: null,
  faceMeshContext: null,

  // Mouse interaction
  isDragging: false,
  dragType: null,
  lastMouseX: 0,
  lastMouseY: 0,
  targetRotation: new THREE.Euler(0, 0, 0),
  targetPosition: new THREE.Vector3(0, 0, 0),

  // Window elements
  avatarWindow: null,
  avatarCanvas: null,
  settingsPanel: null,
  isSettingsOpen: false,
  resizeObserver: null,

  // Resize
  resizeFrameId: null,
  lastKnownSize: { width: 0, height: 0, pixelRatio: 0 },

  // WebSocket audio
  wsAudioCallbackId: null,

  // Config objects (populated by config module)
  globalConfig: null,
  config: null,
};

export const THREE_REF = THREE;


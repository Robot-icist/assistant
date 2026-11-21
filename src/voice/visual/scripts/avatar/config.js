import { state } from "./state.js";

export const defaultModelConfig = {
  showHeadOnly: false,
  headTrackingMode: "off",
  mirrorHorizontalFlip: true,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: Math.PI, z: 0 },
  scale: 1,
  cameraDistance: 3,
  cameraHeight: 1.5,
  cameraTarget: { x: 0, y: 1.2, z: 0 },
  cameraAzimuth: 0,
  cameraPolar: Math.PI / 3,
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
  blinkMinInterval: 2.0,
  blinkMaxInterval: 6.0,
  blinkDuration: 0.15,
  blinkHoldDuration: 0.08,
  doubleBlinkChance: 0.15,
  doubleBlinkDelay: 0.12,
  breathingEnabled: true,
  breathingRate: 0.3,
  breathingAmount: 0.02,
  headSwayEnabled: true,
  headSwayRateX: 0.15,
  headSwayRateY: 0.1,
  headSwayAmountX: 0.01,
  headSwayAmountY: 0.006,
  neckSwayFactor: 0.3,
  microMovementEnabled: true,
  microMovementRate: 0.05,
  microMovementAmount: 0.003,
};

export const defaultGlobalConfig = {
  modelUrl: "/models/fem_vroid.vrm",
  windowBounds: { x: 10, y: 10, width: 400, height: 500 },
  previewBounds: null,
  previewSize: null,
  modelConfigs: {},
  windowOpacity: 0.95,
};

// Initialize state config objects
state.globalConfig = { ...defaultGlobalConfig };
state.config = { ...defaultModelConfig };

export const AVATAR_CONFIG_KEY = state.AVATAR_CONFIG_KEY;

export function loadConfig() {
  try {
    const saved = localStorage.getItem(AVATAR_CONFIG_KEY);
    if (saved) {
      state.globalConfig = { ...defaultGlobalConfig, ...JSON.parse(saved) };
      if (!state.globalConfig.modelUrl) {
        state.globalConfig.modelUrl = defaultGlobalConfig.modelUrl;
      }
      const modelUrl = state.globalConfig.modelUrl;
      if (state.globalConfig.modelConfigs[modelUrl]) {
        state.config = { ...defaultModelConfig, ...state.globalConfig.modelConfigs[modelUrl] };
      } else {
        state.config = { ...defaultModelConfig };
      }
    }
  } catch (e) {
    console.warn("Failed to load avatar config:", e);
  }
}

export function saveConfig() {
  try {
    const modelUrl = state.globalConfig.modelUrl;
    state.globalConfig.modelConfigs[modelUrl] = { ...state.config };
    localStorage.setItem(AVATAR_CONFIG_KEY, JSON.stringify(state.globalConfig));
  } catch (e) {
    console.warn("Failed to save avatar config:", e);
  }
}

export function loadModelConfig(modelUrl) {
  if (state.globalConfig.modelConfigs[modelUrl]) {
    state.config = { ...defaultModelConfig, ...state.globalConfig.modelConfigs[modelUrl] };
  } else {
    state.config = { ...defaultModelConfig };
  }
}

export function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}


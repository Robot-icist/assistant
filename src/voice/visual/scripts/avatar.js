import { state } from "./avatar/state.js";
import { loadConfig, saveConfig, deepMerge } from "./avatar/config.js";
import { createAvatarWindow } from "./avatar/windowManager.js";
import { loadVRM } from "./avatar/vrm.js";
import { setupAudioAnalysis } from "./avatar/lipSync.js";
import { applyConfig } from "./avatar/vrm.js";
import { stopHeadTracking } from "./avatar/headTracking.js";

// Public API
window.Avatar = {
  init: createAvatarWindow,
  loadModel: loadVRM,
  setAudioElement: setupAudioAnalysis,
  setConfig: (newConfig) => {
    state.config = deepMerge(state.config, newConfig);
    saveConfig();
    applyConfig();
  },
  getConfig: () => ({ ...state.config }),
  show: () => {
    if (state.avatarWindow) state.avatarWindow.style.display = "flex";
  },
  hide: () => {
    if (state.avatarWindow) state.avatarWindow.style.display = "none";
  },
  stop: () => {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    stopHeadTracking();
    state.wsAudioCallbackId = null;
    if (state.mixer) {
      state.mixer.uncacheRoot(state.vrm?.scene);
      state.mixer = null;
    }
    if (state.vrm) {
      state.scene.remove(state.vrm.scene);
      state.vrm = null;
    }
    if (state.renderer) {
      state.renderer.dispose();
      state.renderer = null;
    }
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = null;
    }
    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
    }
    state.analyser = null;
    state.waveformAnalyser = null;
    state.audioSource = null;
    state.mediaElement = null;
  },
  clear: () => {
    window.Avatar.stop();
    if (state.avatarWindow) {
      state.avatarWindow.remove();
      state.avatarWindow = null;
    }
  },
  speak: (audioElement) => {
    setupAudioAnalysis(audioElement);
  },
};

// live binding for config export
export const avatarConfig = new Proxy({}, {
  get(_t, p) { return state.config ? state.config[p] : undefined; },
  set(_t, p, v) { if (state.config) state.config[p] = v; return true; },
  has(_t, p) { return state.config ? p in state.config : false; },
  ownKeys() { return state.config ? Object.keys(state.config) : []; },
  getOwnPropertyDescriptor(_t, p) { return state.config ? Object.getOwnPropertyDescriptor(state.config, p) : undefined; },
});

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
});

// Keyboard shortcut: 'A' key to toggle avatar window
document.addEventListener("keydown", (e) => {
  if (e.key === "a" || e.key === "A") {
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (!e.ctrlKey && !e.metaKey && !e.altKey && activeTag !== "INPUT" && activeTag !== "TEXTAREA" && activeTag !== "SELECT") {
      e.preventDefault();
      if (window.Avatar) {
        const win = document.getElementById("avatar-window");
        if (win && win.style.display !== "none") {
          window.Avatar.hide();
        } else if (win) {
          window.Avatar.show();
        } else {
          window.Avatar.init();
        }
      }
    }
  }
});

// Export for module usage (preserve original API)
export { createAvatarWindow, loadVRM, setupAudioAnalysis };
export default window.Avatar;


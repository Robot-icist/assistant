import { state } from "./state.js";
import * as THREE from "three";
import { loadConfig, saveConfig } from "./config.js";
import { initThreeJS } from "./scene.js";
import { loadVRM, updateHeadOnlyMode } from "./vrm.js";
import { initHeadTracking } from "./headTracking.js";
import { subscribeToWebSocketAudio } from "./wsAudio.js";
import { setArmPosition } from "./arms.js";
import { setBlinkWeight } from "./idle.js";
import { onWindowResize, scheduleResize } from "./resize.js";

// ============ Window Management ============
export function createAvatarWindow() {
  // Ensure config is loaded (in case called before DOMContentLoaded)
  loadConfig();
  
  if (state.avatarWindow) {
    state.avatarWindow.style.display = "flex";
    // Update opacity in case it changed
    const opacity = state.globalConfig.windowOpacity ?? 0.95;
    state.avatarWindow.style.background = `rgba(20, 20, 30, ${opacity})`;
    // Scene background is transparent (null), canvas alpha shows window background
    return state.avatarWindow;
  }

  const opacity = state.globalConfig.windowOpacity ?? 0.95;
  state.avatarWindow = document.createElement("div");
  state.avatarWindow.id = "avatar-window";
  state.avatarWindow.style.cssText = `
    position: fixed;
    left: ${state.globalConfig.windowBounds.x}px;
    top: ${state.globalConfig.windowBounds.y}px;
    width: ${state.globalConfig.windowBounds.width}px;
    height: ${state.globalConfig.windowBounds.height}px;
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
    touch-action: none;
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
  state.avatarWindow.appendChild(titleBar);

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
  state.avatarCanvas = document.createElement("canvas");
  state.avatarCanvas.style.cssText = `
    width: 100%;
    height: 100%;
    display: block;
  `;
  // Handle WebGL context loss
  state.avatarCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.warn("[Avatar] WebGL context lost");
  });
  state.avatarCanvas.addEventListener("webglcontextrestored", () => {
    console.log("[Avatar] WebGL context restored, reinitializing...");
    if (state.avatarCanvas && !state.renderer) {
      initThreeJS(state.avatarCanvas);
      if (state.vrm) {
        state.scene.add(state.vrm.scene);
      }
    }
  });
  canvasContainer.appendChild(state.avatarCanvas);
  state.avatarWindow.appendChild(canvasContainer);

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
    touch-action: none;
  `;
  canvasContainer.appendChild(resizeHandle);

  // Settings panel (hidden by default)
  state.settingsPanel = createSettingsPanel();
  state.settingsPanel.style.display = "none";
  state.avatarWindow.appendChild(state.settingsPanel);

  // Event listeners
  setupWindowEvents(state.avatarWindow, titleBar, resizeHandle, canvasContainer);

  document.body.appendChild(state.avatarWindow);

  // Auto-start saved head tracking mode (within user gesture so camera permission works)
  if (state.config.headTrackingMode && state.config.headTrackingMode !== "off" && !state.headTrackingActive) {
    initHeadTracking(state.config.headTrackingMode).catch((err) => {
      console.error("[Avatar] Failed to auto-start head tracking:", err);
    });
  }

  // Initialize Three.js
  initThreeJS(state.avatarCanvas);

  // Force initial resize to sync renderer/camera
  requestAnimationFrame(() => onWindowResize());

  // Subscribe to WebSocket audio for lip sync via WS.addCallback
  subscribeToWebSocketAudio();

  return state.avatarWindow;
}

export function createSettingsPanel() {
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
        <input type="checkbox" id="setting-head-only" ${state.config.showHeadOnly ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Head Only Mode</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-idle" ${state.config.idleEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Idle Animations</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-lipsync" ${state.config.lipSyncEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Lip Sync</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-blink" ${state.config.blinkEnabled ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Auto Blink</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Head Tracking Mode</label>
      <select id="setting-head-tracking" style="width: 100%; padding: 6px; background: #1a1a2e; border: 1px solid #333; border-radius: 4px; color: #eee;">
        <option value="off" ${state.config.headTrackingMode === "off" ? "selected" : ""}>Off</option>
        <option value="follow" ${state.config.headTrackingMode === "follow" ? "selected" : ""}>Follow Face</option>
        <option value="mirror" ${state.config.headTrackingMode === "mirror" ? "selected" : ""}>Mirror Face</option>
      </select>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="setting-mirror-flip" ${state.config.mirrorHorizontalFlip ? "checked" : ""} style="accent-color: #4ade80;">
        <span>Mirror Horizontal (flip) — mirror mode only</span>
      </label>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Model</label>
      <select id="setting-model" style="width: 100%; padding: 6px; background: #1a1a2e; border: 1px solid #333; border-radius: 4px; color: #eee;">
        <option value="">Loading models...</option>
      </select>
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Scale: <span id="scale-value">${state.config.scale.toFixed(2)}</span></label>
      <input type="range" id="setting-scale" min="0.5" max="3" step="0.1" value="${state.config.scale}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Camera Distance: <span id="cam-dist-value">${state.config.cameraDistance.toFixed(1)}</span></label>
      <input type="range" id="setting-cam-dist" min="1" max="10" step="0.5" value="${state.config.cameraDistance}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Camera Height: <span id="cam-height-value">${state.config.cameraHeight.toFixed(1)}</span></label>
      <input type="range" id="setting-cam-height" min="0.5" max="3" step="0.1" value="${state.config.cameraHeight}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div class="setting-group" style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px;">Window Opacity: <span id="opacity-value">${(state.globalConfig.windowOpacity ?? 0.95).toFixed(2)}</span></label>
      <input type="range" id="setting-opacity" min="0.1" max="1" step="0.05" value="${state.globalConfig.windowOpacity ?? 0.95}" style="width: 100%; accent-color: #4ade80;">
    </div>

    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 16px;">
      <h4 style="margin: 0 0 12px; font-size: 13px;">Model Transform</h4>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position X: <span id="pos-x-value">${state.config.position.x.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-x" min="-2" max="2" step="0.05" value="${state.config.position.x}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position Y: <span id="pos-y-value">${state.config.position.y.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-y" min="-1" max="2" step="0.05" value="${state.config.position.y}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Position Z: <span id="pos-z-value">${state.config.position.z.toFixed(2)}</span></label>
        <input type="range" id="setting-pos-z" min="-2" max="2" step="0.05" value="${state.config.position.z}" style="width: 100%; accent-color: #4ade80;">
      </div>
      <div class="setting-group" style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px;">Rotation Y: <span id="rot-y-value">${state.config.rotation.y.toFixed(2)}</span></label>
        <input type="range" id="setting-rot-y" min="-3.14" max="3.14" step="0.05" value="${state.config.rotation.y}" style="width: 100%; accent-color: #4ade80;">
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
          <label style="display: block; margin-bottom: 4px;">Blink Interval: <span id="blink-interval-value">${state.config.blinkMinInterval.toFixed(1)} - ${state.config.blinkMaxInterval.toFixed(1)}s</span></label>
          <div style="display: flex; gap: 8px; margin-bottom: 4px;">
            <div style="flex: 1;">
              <label style="font-size: 11px; color: #aaa;">Min</label>
              <input type="range" id="setting-blink-min" min="0.5" max="10" step="0.5" value="${state.config.blinkMinInterval}" style="width: 100%; accent-color: #4ade80;">
            </div>
            <div style="flex: 1;">
              <label style="font-size: 11px; color: #aaa;">Max</label>
              <input type="range" id="setting-blink-max" min="1" max="15" step="0.5" value="${state.config.blinkMaxInterval}" style="width: 100%; accent-color: #4ade80;">
            </div>
          </div>
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Blink Duration: <span id="blink-dur-value">${state.config.blinkDuration.toFixed(2)}s</span></label>
          <input type="range" id="setting-blink-dur" min="0.05" max="0.5" step="0.01" value="${state.config.blinkDuration}" style="width: 100%; accent-color: #4ade80;">
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Blink Hold: <span id="blink-hold-value">${state.config.blinkHoldDuration.toFixed(2)}s</span></label>
          <input type="range" id="setting-blink-hold" min="0.02" max="0.3" step="0.01" value="${state.config.blinkHoldDuration}" style="width: 100%; accent-color: #4ade80;">
        </div>

        <div class="setting-group" style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px;">Double Blink Chance: <span id="blink-double-value">${(state.config.doubleBlinkChance * 100).toFixed(0)}%</span></label>
          <input type="range" id="setting-blink-double" min="0" max="1" step="0.05" value="${state.config.doubleBlinkChance}" style="width: 100%; accent-color: #4ade80;">
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
          <input type="checkbox" id="setting-breathing" ${state.config.breathingEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Breathing</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Breathing Rate: <span id="breath-rate-value">${state.config.breathingRate.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-breath-rate" min="0.1" max="1" step="0.05" value="${state.config.breathingRate}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Breathing Amount: <span id="breath-amt-value">${state.config.breathingAmount.toFixed(3)}</span></label>
        <input type="range" id="setting-breath-amt" min="0.005" max="0.05" step="0.001" value="${state.config.breathingAmount}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="setting-head-sway" ${state.config.headSwayEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Head Sway</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway X Rate: <span id="sway-x-rate-value">${state.config.headSwayRateX.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-sway-x-rate" min="0.05" max="1" step="0.05" value="${state.config.headSwayRateX}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway X Amount: <span id="sway-x-amt-value">${state.config.headSwayAmountX.toFixed(3)}</span></label>
        <input type="range" id="setting-sway-x-amt" min="0.002" max="0.03" step="0.001" value="${state.config.headSwayAmountX}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway Y Rate: <span id="sway-y-rate-value">${state.config.headSwayRateY.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-sway-y-rate" min="0.05" max="1" step="0.05" value="${state.config.headSwayRateY}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Head Sway Y Amount: <span id="sway-y-amt-value">${state.config.headSwayAmountY.toFixed(3)}</span></label>
        <input type="range" id="setting-sway-y-amt" min="0.001" max="0.02" step="0.001" value="${state.config.headSwayAmountY}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Neck Follow Factor: <span id="neck-factor-value">${state.config.neckSwayFactor.toFixed(2)}</span></label>
        <input type="range" id="setting-neck-factor" min="0" max="1" step="0.05" value="${state.config.neckSwayFactor}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="setting-micro-move" ${state.config.microMovementEnabled ? "checked" : ""} style="accent-color: #4ade80;">
          <span>Micro Movements</span>
        </label>
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Micro Movement Rate: <span id="micro-rate-value">${state.config.microMovementRate.toFixed(2)} Hz</span></label>
        <input type="range" id="setting-micro-rate" min="0.01" max="0.2" step="0.01" value="${state.config.microMovementRate}" style="width: 100%; accent-color: #4ade80;">
      </div>

      <div class="setting-group" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px;">Micro Movement Amount: <span id="micro-amt-value">${state.config.microMovementAmount.toFixed(3)}</span></label>
        <input type="range" id="setting-micro-amt" min="0.001" max="0.01" step="0.001" value="${state.config.microMovementAmount}" style="width: 100%; accent-color: #4ade80;">
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

  // Populate model list from server
  setTimeout(() => populateModelSelect(panel.querySelector("#setting-model")), 0);

  // Event listeners for settings
  setupSettingsEvents(panel);

  return panel;
}

export function populateArmControls(panel) {
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
      const value = state.config.armPositions[bone.key]?.[axis] || 0;
      
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

export async function populateModelSelect(select) {
  if (!select) return;
  const current = state.globalConfig.modelUrl;
  let models = [];
  try {
    const res = await fetch("/api/vrm-models");
    if (res.ok) models = await res.json();
  } catch (e) {
    console.warn("[Avatar] Failed to fetch VRM model list:", e);
  }
  if (!Array.isArray(models) || models.length === 0) {
    // Fallback to known defaults
    models = [
      { name: "fem_vroid.vrm", url: "/models/fem_vroid.vrm" },
      { name: "masc_vroid.vrm", url: "/models/masc_vroid.vrm" },
    ];
  }
  // Ensure the currently selected model is present
  if (current && !models.some((m) => m.url === current)) {
    models.unshift({ name: current.split("/").pop(), url: current });
  }
  select.innerHTML = models
    .map((m) => `<option value="${m.url}" ${m.url === current ? "selected" : ""}>${m.name}</option>`)
    .join("");
  // Sync state if needed
  if (!current && models.length) {
    state.globalConfig.modelUrl = models[0].url;
  }
}

export function setupSettingsEvents(panel) {
  // Head only
  panel.querySelector("#setting-head-only").addEventListener("change", (e) => {
    state.config.showHeadOnly = e.target.checked;
    saveConfig();
    updateHeadOnlyMode();
  });

  // Idle animations
  panel.querySelector("#setting-idle").addEventListener("change", (e) => {
    state.config.idleEnabled = e.target.checked;
    // Reset idle time when toggled to avoid jump
    if (state.config.idleEnabled) {
      state.idleTime = 0;
    }
    saveConfig();
  });

  // Lip sync
  panel.querySelector("#setting-lipsync").addEventListener("change", (e) => {
    state.config.lipSyncEnabled = e.target.checked;
    saveConfig();
  });

  // Blink
  panel.querySelector("#setting-blink").addEventListener("change", (e) => {
    state.config.blinkEnabled = e.target.checked;
    // Reset blink state when toggled
    if (state.config.blinkEnabled) {
      state.blinkTimer = 0;
      state.blinkState = 0;
      state.nextBlinkTime = THREE.MathUtils.lerp(state.config.blinkMinInterval, state.config.blinkMaxInterval, Math.random());
      state.isDoubleBlink = false;
    } else {
      setBlinkWeight(0); // Ensure eyes are open
    }
    saveConfig();
  });

  // Blink min interval
  panel.querySelector("#setting-blink-min").addEventListener("input", (e) => {
    state.config.blinkMinInterval = parseFloat(e.target.value);
    panel.querySelector("#blink-interval-value").textContent = `${state.config.blinkMinInterval.toFixed(1)} - ${state.config.blinkMaxInterval.toFixed(1)}s`;
  });
  panel.querySelector("#setting-blink-min").addEventListener("change", () => saveConfig());

  // Blink max interval
  panel.querySelector("#setting-blink-max").addEventListener("input", (e) => {
    state.config.blinkMaxInterval = parseFloat(e.target.value);
    panel.querySelector("#blink-interval-value").textContent = `${state.config.blinkMinInterval.toFixed(1)} - ${state.config.blinkMaxInterval.toFixed(1)}s`;
  });
  panel.querySelector("#setting-blink-max").addEventListener("change", () => saveConfig());

  // Blink duration
  panel.querySelector("#setting-blink-dur").addEventListener("input", (e) => {
    state.config.blinkDuration = parseFloat(e.target.value);
    panel.querySelector("#blink-dur-value").textContent = `${state.config.blinkDuration.toFixed(2)}s`;
  });
  panel.querySelector("#setting-blink-dur").addEventListener("change", () => saveConfig());

  // Blink hold duration
  panel.querySelector("#setting-blink-hold").addEventListener("input", (e) => {
    state.config.blinkHoldDuration = parseFloat(e.target.value);
    panel.querySelector("#blink-hold-value").textContent = `${state.config.blinkHoldDuration.toFixed(2)}s`;
  });
  panel.querySelector("#setting-blink-hold").addEventListener("change", () => saveConfig());

  // Double blink chance
  panel.querySelector("#setting-blink-double").addEventListener("input", (e) => {
    state.config.doubleBlinkChance = parseFloat(e.target.value);
    panel.querySelector("#blink-double-value").textContent = `${(state.config.doubleBlinkChance * 100).toFixed(0)}%`;
  });
  panel.querySelector("#setting-blink-double").addEventListener("change", () => saveConfig());

  // Breathing toggle
  panel.querySelector("#setting-breathing").addEventListener("change", (e) => {
    state.config.breathingEnabled = e.target.checked;
    saveConfig();
  });

  // Breathing rate
  panel.querySelector("#setting-breath-rate").addEventListener("input", (e) => {
    state.config.breathingRate = parseFloat(e.target.value);
    panel.querySelector("#breath-rate-value").textContent = `${state.config.breathingRate.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-breath-rate").addEventListener("change", () => saveConfig());

  // Breathing amount
  panel.querySelector("#setting-breath-amt").addEventListener("input", (e) => {
    state.config.breathingAmount = parseFloat(e.target.value);
    panel.querySelector("#breath-amt-value").textContent = state.config.breathingAmount.toFixed(3);
  });
  panel.querySelector("#setting-breath-amt").addEventListener("change", () => saveConfig());

  // Head sway toggle
  panel.querySelector("#setting-head-sway").addEventListener("change", (e) => {
    state.config.headSwayEnabled = e.target.checked;
    saveConfig();
  });

  // Head sway X rate
  panel.querySelector("#setting-sway-x-rate").addEventListener("input", (e) => {
    state.config.headSwayRateX = parseFloat(e.target.value);
    panel.querySelector("#sway-x-rate-value").textContent = `${state.config.headSwayRateX.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-sway-x-rate").addEventListener("change", () => saveConfig());

  // Head sway X amount
  panel.querySelector("#setting-sway-x-amt").addEventListener("input", (e) => {
    state.config.headSwayAmountX = parseFloat(e.target.value);
    panel.querySelector("#sway-x-amt-value").textContent = state.config.headSwayAmountX.toFixed(3);
  });
  panel.querySelector("#setting-sway-x-amt").addEventListener("change", () => saveConfig());

  // Head sway Y rate
  panel.querySelector("#setting-sway-y-rate").addEventListener("input", (e) => {
    state.config.headSwayRateY = parseFloat(e.target.value);
    panel.querySelector("#sway-y-rate-value").textContent = `${state.config.headSwayRateY.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-sway-y-rate").addEventListener("change", () => saveConfig());

  // Head sway Y amount
  panel.querySelector("#setting-sway-y-amt").addEventListener("input", (e) => {
    state.config.headSwayAmountY = parseFloat(e.target.value);
    panel.querySelector("#sway-y-amt-value").textContent = state.config.headSwayAmountY.toFixed(3);
  });
  panel.querySelector("#setting-sway-y-amt").addEventListener("change", () => saveConfig());

  // Neck follow factor
  panel.querySelector("#setting-neck-factor").addEventListener("input", (e) => {
    state.config.neckSwayFactor = parseFloat(e.target.value);
    panel.querySelector("#neck-factor-value").textContent = state.config.neckSwayFactor.toFixed(2);
  });
  panel.querySelector("#setting-neck-factor").addEventListener("change", () => saveConfig());

  // Micro movement toggle
  panel.querySelector("#setting-micro-move").addEventListener("change", (e) => {
    state.config.microMovementEnabled = e.target.checked;
    saveConfig();
  });

  // Micro movement rate
  panel.querySelector("#setting-micro-rate").addEventListener("input", (e) => {
    state.config.microMovementRate = parseFloat(e.target.value);
    panel.querySelector("#micro-rate-value").textContent = `${state.config.microMovementRate.toFixed(2)} Hz`;
  });
  panel.querySelector("#setting-micro-rate").addEventListener("change", () => saveConfig());

  // Micro movement amount
  panel.querySelector("#setting-micro-amt").addEventListener("input", (e) => {
    state.config.microMovementAmount = parseFloat(e.target.value);
    panel.querySelector("#micro-amt-value").textContent = state.config.microMovementAmount.toFixed(3);
  });
  panel.querySelector("#setting-micro-amt").addEventListener("change", () => saveConfig());

  // Head tracking
  panel.querySelector("#setting-head-tracking").addEventListener("change", (e) => {
    initHeadTracking(e.target.value);
  });

  panel.querySelector("#setting-mirror-flip").addEventListener("change", (e) => {
    state.config.mirrorHorizontalFlip = e.target.checked;
    saveConfig();
  });

  // Model
  panel.querySelector("#setting-model").addEventListener("change", async (e) => {
    const newModelUrl = e.target.value;
    if (!newModelUrl) {
      console.warn("[Avatar] Invalid model URL selected");
      return;
    }
    state.globalConfig.modelUrl = newModelUrl;
    saveConfig();
    await loadVRM(state.globalConfig.modelUrl);
  });

  // Scale
  panel.querySelector("#setting-scale").addEventListener("input", (e) => {
    state.config.scale = parseFloat(e.target.value);
    panel.querySelector("#scale-value").textContent = state.config.scale.toFixed(2);
    if (state.vrm) state.vrm.scene.scale.setScalar(state.config.scale);
  });
  panel.querySelector("#setting-scale").addEventListener("change", () => saveConfig());

  // Camera distance
  panel.querySelector("#setting-cam-dist").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#cam-dist-value").textContent = value.toFixed(1);
    if (state.config.showHeadOnly) {
      state.config.headOnlyCameraDistance = value;
    } else {
      state.config.cameraDistance = value;
    }
    if (state.camera && state.controls) {
      // Update camera position based on current spherical coordinates
      const target = state.config.showHeadOnly ? state.config.headOnlyCameraTarget : state.config.cameraTarget;
      const azimuth = state.config.showHeadOnly ? state.config.headOnlyCameraAzimuth : state.config.cameraAzimuth;
      const polar = state.config.showHeadOnly ? state.config.headOnlyCameraPolar : state.config.cameraPolar;
      const sinPolar = Math.sin(polar);
      state.camera.position.set(
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
    if (state.config.showHeadOnly) {
      state.config.headOnlyCameraHeight = value;
    } else {
      state.config.cameraHeight = value;
    }
    if (state.camera && state.controls) {
      // Update camera position based on current spherical coordinates
      const target = state.config.showHeadOnly ? state.config.headOnlyCameraTarget : state.config.cameraTarget;
      const azimuth = state.config.showHeadOnly ? state.config.headOnlyCameraAzimuth : state.config.cameraAzimuth;
      const polar = state.config.showHeadOnly ? state.config.headOnlyCameraPolar : state.config.cameraPolar;
      const distance = state.config.showHeadOnly ? state.config.headOnlyCameraDistance : state.config.cameraDistance;
      const sinPolar = Math.sin(polar);
      state.camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      state.camera.lookAt(target.x, target.y, target.z);
    }
  });
  panel.querySelector("#setting-cam-height").addEventListener("change", () => saveConfig());

  // Window opacity (global setting)
  panel.querySelector("#setting-opacity").addEventListener("input", (e) => {
    state.globalConfig.windowOpacity = parseFloat(e.target.value);
    panel.querySelector("#opacity-value").textContent = state.globalConfig.windowOpacity.toFixed(2);
    if (state.avatarWindow) {
      state.avatarWindow.style.background = `rgba(20, 20, 30, ${state.globalConfig.windowOpacity})`;
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
      state.config.armPositions[boneKey] = state.config.armPositions[boneKey] || {};
      state.config.armPositions[boneKey][axis] = value;
      panel.querySelector(`.arm-value-${boneKey}${axis.toUpperCase()}`).textContent = value.toFixed(2);
      setArmPosition(boneKey, 
        state.config.armPositions[boneKey].x || 0, 
        state.config.armPositions[boneKey].y || 0, 
        state.config.armPositions[boneKey].z || 0);
    });
    slider.addEventListener("change", () => saveConfig());
  });

  // Model position X
  panel.querySelector("#setting-pos-x").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-x-value").textContent = value.toFixed(2);
    if (state.config.showHeadOnly) {
      state.config.headOnlyPosition.x = value;
      state.targetPosition.x = value;
    } else {
      state.config.position.x = value;
      state.targetPosition.x = value;
    }
    if (state.vrm) state.vrm.scene.position.x = value;
  });
  panel.querySelector("#setting-pos-x").addEventListener("change", () => saveConfig());

  // Model position Y
  panel.querySelector("#setting-pos-y").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-y-value").textContent = value.toFixed(2);
    if (state.config.showHeadOnly) {
      state.config.headOnlyPosition.y = value;
      state.targetPosition.y = value;
    } else {
      state.config.position.y = value;
      state.targetPosition.y = value;
    }
    if (state.vrm) state.vrm.scene.position.y = value;
  });
  panel.querySelector("#setting-pos-y").addEventListener("change", () => saveConfig());

  // Model position Z
  panel.querySelector("#setting-pos-z").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#pos-z-value").textContent = value.toFixed(2);
    if (state.config.showHeadOnly) {
      state.config.headOnlyPosition.z = value;
      state.targetPosition.z = value;
    } else {
      state.config.position.z = value;
      state.targetPosition.z = value;
    }
    if (state.vrm) state.vrm.scene.position.z = value;
  });
  panel.querySelector("#setting-pos-z").addEventListener("change", () => saveConfig());

  // Model rotation Y
  panel.querySelector("#setting-rot-y").addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    if (state.config.showHeadOnly) {
      state.config.headOnlyRotation.y = value;
      state.targetRotation.y = value;
    } else {
      state.config.rotation.y = value;
      state.targetRotation.y = value;
    }
    if (state.vrm) state.vrm.scene.rotation.y = value;
  });
  panel.querySelector("#setting-rot-y").addEventListener("change", () => saveConfig());

  // Face front button
  panel.querySelector("#face-front-btn").addEventListener("click", () => {
    const value = Math.PI;
    if (state.config.showHeadOnly) {
      state.config.headOnlyRotation.y = value;
      state.targetRotation.y = value;
    } else {
      state.config.rotation.y = value;
      state.targetRotation.y = value;
    }
    if (state.vrm) state.vrm.scene.rotation.y = value;
    panel.querySelector("#setting-rot-y").value = value;
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    saveConfig();
  });

  // Face back button
  panel.querySelector("#face-back-btn").addEventListener("click", () => {
    const value = 0;
    if (state.config.showHeadOnly) {
      state.config.headOnlyRotation.y = value;
      state.targetRotation.y = value;
    } else {
      state.config.rotation.y = value;
      state.targetRotation.y = value;
    }
    if (state.vrm) state.vrm.scene.rotation.y = value;
    panel.querySelector("#setting-rot-y").value = value;
    panel.querySelector("#rot-y-value").textContent = value.toFixed(2);
    saveConfig();
  });

  // Reset position
  panel.querySelector("#reset-position-btn").addEventListener("click", () => {
    if (state.config.showHeadOnly) {
      state.config.headOnlyPosition = { x: 0, y: 0, z: 0 };
      state.config.headOnlyRotation = { x: 0, y: Math.PI, z: 0 };
      state.targetPosition.set(0, 0, 0);
      state.targetRotation.set(0, Math.PI, 0);
      if (state.vrm) {
        state.vrm.scene.position.set(0, 0, 0);
        state.vrm.scene.rotation.set(0, Math.PI, 0);
      }
    } else {
      state.config.position = { x: 0, y: 0, z: 0 };
      state.config.rotation = { x: 0, y: Math.PI, z: 0 }; // Face front by default
      state.targetPosition.set(0, 0, 0);
      state.targetRotation.set(0, Math.PI, 0);
      if (state.vrm) {
        state.vrm.scene.position.set(0, 0, 0);
        state.vrm.scene.rotation.set(0, Math.PI, 0);
      }
      if (state.controls) state.controls.target.set(0, state.config.cameraHeight * 0.8, 0);
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

export function setupWindowEvents(win, titleBar, resizeHandle, canvasContainer) {
  // Helper to get coordinates from mouse or touch events
  const getPoint = (e) => {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  };

  // Dragging window
  let isMoving = false;
  let moveOffsetX = 0;
  let moveOffsetY = 0;

  const startMove = (e) => {
    if (e.target && e.target.tagName === "BUTTON") return;
    const pt = getPoint(e);
    isMoving = true;
    moveOffsetX = pt.x - win.offsetLeft;
    moveOffsetY = pt.y - win.offsetTop;
    win.style.zIndex = String(Number(win.style.zIndex || 10000) + 1);
    if (e.cancelable) e.preventDefault();
  };
  titleBar.addEventListener("mousedown", startMove);
  titleBar.addEventListener("touchstart", startMove, { passive: false });

  const onMove = (e) => {
    if (!isMoving) return;
    const pt = getPoint(e);
    win.style.left = `${pt.x - moveOffsetX}px`;
    win.style.top = `${pt.y - moveOffsetY}px`;
    state.globalConfig.windowBounds.x = pt.x - moveOffsetX;
    state.globalConfig.windowBounds.y = pt.y - moveOffsetY;
    if (e.cancelable) e.preventDefault();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });

  const endMove = () => {
    if (isMoving) {
      isMoving = false;
      saveConfig();
    }
  };
  document.addEventListener("mouseup", endMove);
  document.addEventListener("touchend", endMove);
  document.addEventListener("touchcancel", endMove);

  // Resizing
  let isResizing = false;
  const startResize = (e) => {
    isResizing = true;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation?.();
  };
  resizeHandle.addEventListener("mousedown", startResize);
  resizeHandle.addEventListener("touchstart", startResize, { passive: false });

  const onResize = (e) => {
    if (!isResizing) return;
    const pt = getPoint(e);
    const newWidth = Math.max(300, pt.x - win.offsetLeft);
    const newHeight = Math.max(200, pt.y - win.offsetTop);
    win.style.width = `${newWidth}px`;
    win.style.height = `${newHeight}px`;
    state.globalConfig.windowBounds.width = newWidth;
    state.globalConfig.windowBounds.height = newHeight;
    // Let flex layout handle canvasContainer sizing - schedule resize (debounced)
    scheduleResize();
    if (e.cancelable) e.preventDefault();
  };
  document.addEventListener("mousemove", onResize);
  document.addEventListener("touchmove", onResize, { passive: false });

  const endResize = () => {
    if (isResizing) {
      isResizing = false;
      saveConfig();
      scheduleResize();
    }
  };
  document.addEventListener("mouseup", endResize);
  document.addEventListener("touchend", endResize);
  document.addEventListener("touchcancel", endResize);

  // Buttons
  win.querySelector("#avatar-close-btn").addEventListener("click", () => {
    window.Avatar.stop();
    win.remove();
    state.avatarWindow = null;
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = null;
    }
  });

  win.querySelector("#avatar-minimize-btn").addEventListener("click", () => {
    const isMinimized = canvasContainer.style.display === "none";
    canvasContainer.style.display = isMinimized ? "flex" : "none";
    resizeHandle.style.display = isMinimized ? "block" : "none";
    win.style.height = isMinimized ? `${state.globalConfig.windowBounds.height}px` : "32px";
    // Trigger resize after maximize
    if (isMinimized) {
      scheduleResize();
    }
  });

  win.querySelector("#avatar-settings-btn").addEventListener("click", () => {
    state.isSettingsOpen = !state.isSettingsOpen;
    state.settingsPanel.style.display = state.isSettingsOpen ? "block" : "none";
    if (state.isSettingsOpen) {
      populateModelSelect(state.settingsPanel.querySelector("#setting-model")).then(() => updateSettingsPanel());
    }
  });

  // Close settings when clicking outside
  document.addEventListener("mousedown", (e) => {
    if (state.isSettingsOpen && !state.settingsPanel.contains(e.target) && e.target.id !== "avatar-settings-btn") {
      state.isSettingsOpen = false;
      state.settingsPanel.style.display = "none";
    }
  });
}
export function updateSettingsPanel() {
  if (!state.settingsPanel) return;
  
  // Update checkboxes
  const headOnlyCb = state.settingsPanel.querySelector("#setting-head-only");
  if (headOnlyCb) headOnlyCb.checked = state.config.showHeadOnly;
  
  const idleCb = state.settingsPanel.querySelector("#setting-idle");
  if (idleCb) idleCb.checked = state.config.idleEnabled;
  
  const lipsyncCb = state.settingsPanel.querySelector("#setting-lipsync");
  if (lipsyncCb) lipsyncCb.checked = state.config.lipSyncEnabled;
  
  const blinkCb = state.settingsPanel.querySelector("#setting-blink");
  if (blinkCb) blinkCb.checked = state.config.blinkEnabled;
  
  // Blink settings
  const blinkMinSlider = state.settingsPanel.querySelector("#setting-blink-min");
  if (blinkMinSlider) {
    blinkMinSlider.value = state.config.blinkMinInterval;
    const blinkIntervalVal = state.settingsPanel.querySelector("#blink-interval-value");
    if (blinkIntervalVal) blinkIntervalVal.textContent = `${state.config.blinkMinInterval.toFixed(1)} - ${state.config.blinkMaxInterval.toFixed(1)}s`;
  }
  const blinkMaxSlider = state.settingsPanel.querySelector("#setting-blink-max");
  if (blinkMaxSlider) {
    blinkMaxSlider.value = state.config.blinkMaxInterval;
    const blinkIntervalVal = state.settingsPanel.querySelector("#blink-interval-value");
    if (blinkIntervalVal) blinkIntervalVal.textContent = `${state.config.blinkMinInterval.toFixed(1)} - ${state.config.blinkMaxInterval.toFixed(1)}s`;
  }
  const blinkDurSlider = state.settingsPanel.querySelector("#setting-blink-dur");
  if (blinkDurSlider) {
    blinkDurSlider.value = state.config.blinkDuration;
    const blinkDurVal = state.settingsPanel.querySelector("#blink-dur-value");
    if (blinkDurVal) blinkDurVal.textContent = `${state.config.blinkDuration.toFixed(2)}s`;
  }
  const blinkHoldSlider = state.settingsPanel.querySelector("#setting-blink-hold");
  if (blinkHoldSlider) {
    blinkHoldSlider.value = state.config.blinkHoldDuration;
    const blinkHoldVal = state.settingsPanel.querySelector("#blink-hold-value");
    if (blinkHoldVal) blinkHoldVal.textContent = `${state.config.blinkHoldDuration.toFixed(2)}s`;
  }
  const blinkDoubleSlider = state.settingsPanel.querySelector("#setting-blink-double");
  if (blinkDoubleSlider) {
    blinkDoubleSlider.value = state.config.doubleBlinkChance;
    const blinkDoubleVal = state.settingsPanel.querySelector("#blink-double-value");
    if (blinkDoubleVal) blinkDoubleVal.textContent = `${(state.config.doubleBlinkChance * 100).toFixed(0)}%`;
  }
  
  // Breathing
  const breathingCb = state.settingsPanel.querySelector("#setting-breathing");
  if (breathingCb) breathingCb.checked = state.config.breathingEnabled;
  const breathRateSlider = state.settingsPanel.querySelector("#setting-breath-rate");
  if (breathRateSlider) {
    breathRateSlider.value = state.config.breathingRate;
    const breathRateVal = state.settingsPanel.querySelector("#breath-rate-value");
    if (breathRateVal) breathRateVal.textContent = `${state.config.breathingRate.toFixed(2)} Hz`;
  }
  const breathAmtSlider = state.settingsPanel.querySelector("#setting-breath-amt");
  if (breathAmtSlider) {
    breathAmtSlider.value = state.config.breathingAmount;
    const breathAmtVal = state.settingsPanel.querySelector("#breath-amt-value");
    if (breathAmtVal) breathAmtVal.textContent = state.config.breathingAmount.toFixed(3);
  }
  
  // Head sway
  const headSwayCb = state.settingsPanel.querySelector("#setting-head-sway");
  if (headSwayCb) headSwayCb.checked = state.config.headSwayEnabled;
  const swayXRateSlider = state.settingsPanel.querySelector("#setting-sway-x-rate");
  if (swayXRateSlider) {
    swayXRateSlider.value = state.config.headSwayRateX;
    const swayXRateVal = state.settingsPanel.querySelector("#sway-x-rate-value");
    if (swayXRateVal) swayXRateVal.textContent = `${state.config.headSwayRateX.toFixed(2)} Hz`;
  }
  const swayXAmtSlider = state.settingsPanel.querySelector("#setting-sway-x-amt");
  if (swayXAmtSlider) {
    swayXAmtSlider.value = state.config.headSwayAmountX;
    const swayXAmtVal = state.settingsPanel.querySelector("#sway-x-amt-value");
    if (swayXAmtVal) swayXAmtVal.textContent = state.config.headSwayAmountX.toFixed(3);
  }
  const swayYRateSlider = state.settingsPanel.querySelector("#setting-sway-y-rate");
  if (swayYRateSlider) {
    swayYRateSlider.value = state.config.headSwayRateY;
    const swayYRateVal = state.settingsPanel.querySelector("#sway-y-rate-value");
    if (swayYRateVal) swayYRateVal.textContent = `${state.config.headSwayRateY.toFixed(2)} Hz`;
  }
  const swayYAmtSlider = state.settingsPanel.querySelector("#setting-sway-y-amt");
  if (swayYAmtSlider) {
    swayYAmtSlider.value = state.config.headSwayAmountY;
    const swayYAmtVal = state.settingsPanel.querySelector("#sway-y-amt-value");
    if (swayYAmtVal) swayYAmtVal.textContent = state.config.headSwayAmountY.toFixed(3);
  }
  const neckFactorSlider = state.settingsPanel.querySelector("#setting-neck-factor");
  if (neckFactorSlider) {
    neckFactorSlider.value = state.config.neckSwayFactor;
    const neckFactorVal = state.settingsPanel.querySelector("#neck-factor-value");
    if (neckFactorVal) neckFactorVal.textContent = state.config.neckSwayFactor.toFixed(2);
  }
  
  // Micro movements
  const microMoveCb = state.settingsPanel.querySelector("#setting-micro-move");
  if (microMoveCb) microMoveCb.checked = state.config.microMovementEnabled;
  const microRateSlider = state.settingsPanel.querySelector("#setting-micro-rate");
  if (microRateSlider) {
    microRateSlider.value = state.config.microMovementRate;
    const microRateVal = state.settingsPanel.querySelector("#micro-rate-value");
    if (microRateVal) microRateVal.textContent = `${state.config.microMovementRate.toFixed(2)} Hz`;
  }
  const microAmtSlider = state.settingsPanel.querySelector("#setting-micro-amt");
  if (microAmtSlider) {
    microAmtSlider.value = state.config.microMovementAmount;
    const microAmtVal = state.settingsPanel.querySelector("#micro-amt-value");
    if (microAmtVal) microAmtVal.textContent = state.config.microMovementAmount.toFixed(3);
  }
  
  // Update selects
  const headTrackingSel = state.settingsPanel.querySelector("#setting-head-tracking");
  if (headTrackingSel) headTrackingSel.value = state.config.headTrackingMode;
  
  const modelSel = state.settingsPanel.querySelector("#setting-model");
  if (modelSel) modelSel.value = state.globalConfig.modelUrl;
  
  // Update sliders
  const scaleSlider = state.settingsPanel.querySelector("#setting-scale");
  if (scaleSlider) {
    scaleSlider.value = state.config.scale;
    const scaleVal = state.settingsPanel.querySelector("#scale-value");
    if (scaleVal) scaleVal.textContent = state.config.scale.toFixed(2);
  }
  
  // Camera settings - use head-only config when in head-only mode
  const camConfig = state.config.showHeadOnly 
    ? { distance: state.config.headOnlyCameraDistance, height: state.config.headOnlyCameraHeight }
    : { distance: state.config.cameraDistance, height: state.config.cameraHeight };
  
  const camDistSlider = state.settingsPanel.querySelector("#setting-cam-dist");
  if (camDistSlider) {
    camDistSlider.value = camConfig.distance;
    const camDistVal = state.settingsPanel.querySelector("#cam-dist-value");
    if (camDistVal) camDistVal.textContent = camConfig.distance.toFixed(1);
  }
  
  const camHeightSlider = state.settingsPanel.querySelector("#setting-cam-height");
  if (camHeightSlider) {
    camHeightSlider.value = camConfig.height;
    const camHeightVal = state.settingsPanel.querySelector("#cam-height-value");
    if (camHeightVal) camHeightVal.textContent = camConfig.height.toFixed(1);
  }
  
  // Update arm sliders
  state.settingsPanel.querySelectorAll("input[data-bone]").forEach((slider) => {
    const boneKey = slider.dataset.bone;
    const axis = slider.dataset.axis;
    const value = state.config.armPositions[boneKey]?.[axis] || 0;
    slider.value = value;
    const valSpan = state.settingsPanel.querySelector(`.arm-value-${boneKey}${axis.toUpperCase()}`);
    if (valSpan) valSpan.textContent = value.toFixed(2);
  });

  // Update model position/rotation sliders (use head-only config when in head-only mode)
  const posConfig = state.config.showHeadOnly ? state.config.headOnlyPosition : state.config.position;
  const rotConfig = state.config.showHeadOnly ? state.config.headOnlyRotation : state.config.rotation;
  
  const posXSlider = state.settingsPanel.querySelector("#setting-pos-x");
  if (posXSlider) {
    posXSlider.value = posConfig.x;
    const posXVal = state.settingsPanel.querySelector("#pos-x-value");
    if (posXVal) posXVal.textContent = posConfig.x.toFixed(2);
  }
  const posYSlider = state.settingsPanel.querySelector("#setting-pos-y");
  if (posYSlider) {
    posYSlider.value = posConfig.y;
    const posYVal = state.settingsPanel.querySelector("#pos-y-value");
    if (posYVal) posYVal.textContent = posConfig.y.toFixed(2);
  }
  const posZSlider = state.settingsPanel.querySelector("#setting-pos-z");
  if (posZSlider) {
    posZSlider.value = posConfig.z;
    const posZVal = state.settingsPanel.querySelector("#pos-z-value");
    if (posZVal) posZVal.textContent = posConfig.z.toFixed(2);
  }
  const rotYSlider = state.settingsPanel.querySelector("#setting-rot-y");
  if (rotYSlider) {
    rotYSlider.value = rotConfig.y;
    const rotYVal = state.settingsPanel.querySelector("#rot-y-value");
    if (rotYVal) rotYVal.textContent = rotConfig.y.toFixed(2);
  }
}


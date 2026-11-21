import { state } from "./state.js";
import * as THREE from "three";
import { loadFaceMesh } from "./faceMesh.js";
import { saveConfig } from "./config.js";

// ============ Head Tracking ============
export function createPreviewOverlay() {
  if (state.previewCanvas) return state.previewCanvas;
  
  state.previewCanvas = document.createElement("canvas");
  state.previewCanvas.width = 160;
  state.previewCanvas.height = 120;
  state.previewCanvas.style.cssText = `
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
  state.previewContext = state.previewCanvas.getContext("2d");
  document.body.appendChild(state.previewCanvas);
  return state.previewCanvas;
}

export function removePreviewOverlay() {
  if (state.previewCanvas) {
    state.previewCanvas.remove();
    state.previewCanvas = null;
    state.previewContext = null;
  }
}

export async function initHeadTracking(mode) {
  state.config.headTrackingMode = mode;
  saveConfig();

  if (mode === "off") {
    stopHeadTracking();
    return;
  }

  if (!state.videoElement) {
    state.videoElement = document.createElement("video");
    state.videoElement.style.display = "none";
    document.body.appendChild(state.videoElement);
  }

  // Create preview overlay (small 160x120 for UI)
  createPreviewOverlay();

  try {
    // Request higher resolution for detection
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    state.videoElement.srcObject = stream;
    await state.videoElement.play();
    
    // Load and configure MediaPipe Face Mesh
    await loadFaceMesh();
    if (state.faceMesh) {
      state.faceMesh.onResults(onFaceMeshResults);
    }
    
    // Disable VRM lookAt autoUpdate so it doesn't fight head tracking
    if (state.vrm && state.vrm.lookAt) {
      state.vrm.lookAt.autoUpdate = false;
    }
    
    // Stiffen head/neck spring bones so they don't override manual rotation
    if (state.vrm && state.vrm.springBoneManager) {
      state.vrm.springBoneManager.joints.forEach((joint) => {
        if (joint.name === "head" || joint.name === "neck") {
          joint.stiffness = 1000;
          joint.dragForce = 0;
          joint.gravityPower = 0;
        }
      });
    }
    
    state.headTrackingActive = true;
    trackFace();
  } catch (error) {
    console.error("Failed to start head tracking:", error);
    state.config.headTrackingMode = "off";
    saveConfig();
    removePreviewOverlay();
    stopFaceMesh();
  }
}

export function stopHeadTracking() {
  state.headTrackingActive = false;
  removePreviewOverlay();
  stopFaceMesh();
  if (state.videoElement && state.videoElement.srcObject) {
    state.videoElement.srcObject.getTracks().forEach((track) => track.stop());
    state.videoElement.srcObject = null;
  }
  // Reset head/neck bones to neutral
  if (state.vrm && state.vrm.humanoid) {
    const headBone = state.vrm.humanoid.getNormalizedBoneNode("head");
    const neckBone = state.vrm.humanoid.getNormalizedBoneNode("neck");
    if (headBone) {
      headBone.rotation.set(0, 0, 0);
    }
    if (neckBone) {
      neckBone.rotation.set(0, 0, 0);
    }
  }
  // Restore VRM lookAt autoUpdate
  if (state.vrm && state.vrm.lookAt) {
    state.vrm.lookAt.autoUpdate = true;
  }
  // Restore spring bones
  if (state.vrm && state.vrm.springBoneManager) {
    state.vrm.springBoneManager.joints.forEach((joint) => {
      if (joint.name === "head" || joint.name === "neck") {
        joint.stiffness = 0.8;
        joint.dragForce = 0.3;
        joint.gravityPower = 0.5;
      }
    });
  }
  // Reset head tracking state
  state.headTrackingState = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    leftEyeOpenness: 1,
    rightEyeOpenness: 1,
    mouthOpenness: 0,
    mouthWidth: 0,
  };
  state.faceDetected = false;
}

// MediaPipe Face Mesh tracking state

export async function trackFace() {
  if (!state.headTrackingActive || !state.videoElement || !state.vrm) return;

  try {
    // Check video is ready
    if (state.videoElement.readyState < 2) { // HAVE_CURRENT_DATA
      if (state.headTrackingActive) requestAnimationFrame(trackFace);
      return;
    }

    // Ensure MediaPipe Face Mesh is loaded
    if (!state.faceMeshLoaded) {
      await loadFaceMesh();
      if (!state.faceMeshLoaded) {
        console.warn("[Avatar] Face Mesh not available, stopping head tracking");
        stopHeadTracking();
        return;
      }
    }

    // Process frame with MediaPipe Face Mesh
    // Results are delivered via onFaceMeshResults callback
    await state.faceMesh.send({ image: state.videoElement });
  } catch (e) {
    console.error("[Avatar] trackFace error:", e);
  }

  // Only continue tracking if still active
  if (state.headTrackingActive) {
    requestAnimationFrame(trackFace);
  }
}

// MediaPipe Face Mesh callback
export function onFaceMeshResults(results) {
  state.faceMeshResults = results;
  if (!state.headTrackingActive) return;
  if (results && results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    state.faceDetected = true;
    if (state.previewContext && state.previewCanvas) {
      drawPreviewOverlay(landmarks);
    }
    applyHeadTrackingFromLandmarks(landmarks);
  } else {
    // No face detected: hide mask, stop following, return to idle
    state.faceDetected = false;
    if (state.previewContext && state.previewCanvas) {
      drawPreviewOverlay(null);
    }
    // Reset tracking state and bones so avatar returns to neutral/idle
    state.headTrackingState.yaw = 0;
    state.headTrackingState.pitch = 0;
    state.headTrackingState.roll = 0;
    state.headTrackingState.leftEyeOpenness = 1;
    state.headTrackingState.rightEyeOpenness = 1;
    state.headTrackingState.mouthOpenness = 0;
    state.headTrackingState.mouthWidth = 0;
    if (state.vrm && state.vrm.humanoid) {
      const headBone = state.vrm.humanoid.getNormalizedBoneNode("head");
      const neckBone = state.vrm.humanoid.getNormalizedBoneNode("neck");
      if (headBone) headBone.rotation.set(0, 0, 0);
      if (neckBone) neckBone.rotation.set(0, 0, 0);
    }
    // Reset mouth expressions
    if (state.vrm && state.vrm.expressionManager) {
      ["aa", "a", "oh", "o", "ee", "e"].forEach((n) => setExpressionWeight(n, 0));
    }
  }
}

export function drawPreviewOverlay(landmarks) {
  if (!state.previewContext || !state.previewCanvas || !state.videoElement) return;
  
  const ctx = state.previewContext;
  const w = state.previewCanvas.width;
  const h = state.previewCanvas.height;
  
  // Draw video frame (flipped horizontally for mirror effect - user sees themselves naturally)
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(state.videoElement, 0, 0, w, h);
  ctx.restore();
  
  // Draw face landmarks aligned with mirrored video (flip x manually)
  if (landmarks) {
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 1;
    
    // Draw key points: nose tip (1), left eye (33), right eye (263), chin (152), forehead (10)
    const keyPoints = [1, 33, 263, 152, 10, 61, 291]; // nose, left eye, right eye, chin, forehead, mouth corners
    keyPoints.forEach(idx => {
      if (landmarks[idx]) {
        // Flip X coordinate to match flipped video
        const x = (1 - landmarks[idx].x) * w;
        const y = landmarks[idx].y * h;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#4ade80";
        ctx.fill();
      }
    });
    
    // Draw face outline (face oval) - flip X coordinates
    const faceOvalIndices = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400,
      377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
    ];
    ctx.beginPath();
    faceOvalIndices.forEach((idx, i) => {
      if (landmarks[idx]) {
        const x = (1 - landmarks[idx].x) * w;
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
    ctx.fillText(`Mode: ${state.config.headTrackingMode}`, 5, h - 5);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "11px monospace";
    ctx.fillText("No face detected", 5, h / 2);
    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.fillText(`Mode: ${state.config.headTrackingMode}`, 5, h - 5);
  }
}


// Current voice activity level (0-1) from lip sync, for blending with face tracking
// Whether a face is currently detected by head tracking

export function applyHeadTrackingFromLandmarks(landmarks) {
  // MediaPipe Face Mesh landmark indices:
  // 1 = nose tip, 33 = left eye inner corner, 263 = right eye inner corner
  // 152 = chin, 10 = forehead, 61 = mouth left, 291 = mouth right
  // 168 = nose bridge, 197 = nose bridge upper
  // 33/133 = left eye, 362/263 = right eye
  // For eyes: 159, 145 (left upper/lower), 386, 374 (right upper/lower)
  // For mouth: 13, 14 (upper/lower lip), 78, 308 (mouth corners)
  
  const noseTip = landmarks[1];
  const leftEyeInner = landmarks[33];
  const rightEyeInner = landmarks[263];
  const leftEyeOuter = landmarks[133];
  const rightEyeOuter = landmarks[362];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const mouthLeft = landmarks[61];
  const mouthRight = landmarks[291];
  // Eye openness landmarks
  const leftEyeUpper = landmarks[159];
  const leftEyeLower = landmarks[145];
  const rightEyeUpper = landmarks[386];
  const rightEyeLower = landmarks[374];
  // Mouth openness landmarks
  const mouthUpper = landmarks[13];
  const mouthLower = landmarks[14];
  const mouthCornerLeft = landmarks[78];
  const mouthCornerRight = landmarks[308];

  if (!noseTip || !leftEyeInner || !rightEyeInner) return;

  // Calculate head pose from landmarks
  // Eye center as reference for head center
  const eyeCenterX = (leftEyeInner.x + rightEyeInner.x) * 0.5;
  const eyeCenterY = (leftEyeInner.y + rightEyeInner.y) * 0.5;
  
  // Nose tip relative to eye center gives us head rotation
  const noseOffsetX = noseTip.x - eyeCenterX;
  const noseOffsetY = noseTip.y - eyeCenterY;
  
  // Calculate head rotation angles
  // X rotation (pitch): nose up/down relative to eyes (positive = looking up)
  // Y rotation (yaw): nose left/right relative to eyes (positive = looking right)
  // Z rotation (roll): eye line tilt
  
  const eyeVectorX = rightEyeInner.x - leftEyeInner.x;
  const eyeVectorY = rightEyeInner.y - leftEyeInner.y;
  const eyeDistance = Math.sqrt(eyeVectorX * eyeVectorX + eyeVectorY * eyeVectorY);
  
  // Normalize nose offset by eye distance for scale-invariant rotation
  // MediaPipe coordinates: x increases right, y increases down
  // Three.js: pitch positive = up (nose up), yaw positive = right (nose right), roll positive = clockwise
  // Subtract neutral offset for pitch (nose is naturally below eyes)
  const neutralPitch = 0.5;
  const pitch = -((noseOffsetY / eyeDistance) - neutralPitch) * 1.5;  // Negative because MediaPipe Y down = Three.js pitch up
  const yaw = (noseOffsetX / eyeDistance) * 1.5;     // MediaPipe X right = Three.js yaw right
  
  // Roll from eye line tilt
  const roll = Math.atan2(eyeVectorY, eyeVectorX);
  
  // Calculate eye openness (0 = closed, 1 = open)
  // Use a slightly smaller divisor so partially open eyes still read as open
  let leftEyeOpenness = 1;
  let rightEyeOpenness = 1;
  if (leftEyeUpper && leftEyeLower && leftEyeInner && leftEyeOuter) {
    const leftEyeHeight = Math.abs(leftEyeLower.y - leftEyeUpper.y);
    const leftEyeWidth = Math.max(1e-6, Math.hypot(leftEyeOuter.x - leftEyeInner.x, leftEyeOuter.y - leftEyeInner.y));
    leftEyeOpenness = THREE.MathUtils.clamp(leftEyeHeight / (leftEyeWidth * 0.2), 0, 1);
  }
  if (rightEyeUpper && rightEyeLower && rightEyeInner && rightEyeOuter) {
    const rightEyeHeight = Math.abs(rightEyeLower.y - rightEyeUpper.y);
    const rightEyeWidth = Math.max(1e-6, Math.hypot(rightEyeOuter.x - rightEyeInner.x, rightEyeOuter.y - rightEyeInner.y));
    rightEyeOpenness = THREE.MathUtils.clamp(rightEyeHeight / (rightEyeWidth * 0.2), 0, 1);
  }
  
  // Calculate mouth openness and width
  let mouthOpenness = 0;
  let mouthWidth = 0;
  if (mouthUpper && mouthLower && mouthCornerLeft && mouthCornerRight) {
    const mouthHeight = Math.abs(mouthLower.y - mouthUpper.y);
    const mouthCornerDist = Math.abs(mouthCornerRight.x - mouthCornerLeft.x);
    mouthOpenness = THREE.MathUtils.clamp(mouthHeight / (eyeDistance * 0.3), 0, 1);
    mouthWidth = THREE.MathUtils.clamp(mouthCornerDist / (eyeDistance * 0.5), 0, 1);
  }
  
  // Sensitivity and smoothing
  const sensitivity = 1.5;
  const smoothing = 0.2;
  
  let targetYaw, targetPitch, targetRoll;
  
  if (state.config.headTrackingMode === "follow") {
    // Follow mode: TRACK the user's head POSITION in the frame (like a camera
    // following a subject). Do NOT reproduce the user's head orientation/tilt.
    // Drive yaw/pitch from where the face is relative to frame center, not from
    // the head-pose angles. Roll is zeroed so head tilt is never copied.
    const faceCenterX = noseTip.x; // 0..1, 0.5 = center
    const faceCenterY = noseTip.y;
    // Reduced gains so the avatar gazes at the user instead of overshooting
    // when the face moves toward the edge of the frame.
    targetYaw = THREE.MathUtils.clamp((0.5 - faceCenterX) * 1.0, -0.5, 0.5);
    targetPitch = THREE.MathUtils.clamp(-(faceCenterY - 0.5) * 0.8, -0.45, 0.45);
    // Gentle roll: tilt slightly on horizontal movement, plus a small vertical
    // component so the head feels alive when looking up/down.
    targetRoll = (0.5 - faceCenterX) * 0.25 + (faceCenterY - 0.5) * 0.15;
  } else if (state.config.headTrackingMode === "mirror") {
    // Mirror mode: avatar copies user's head movement.
    // mirrorHorizontalFlip=true keeps the natural mirror reversal
    // (look right -> avatar looks left). Set false to reverse it.
    const yawSign = state.config.mirrorHorizontalFlip ? 1 : -1;
    // Reduced gains to avoid overshooting; clamp to keep within natural range
    targetYaw = THREE.MathUtils.clamp(yaw * 0.8 * yawSign, -0.7, 0.7);
    targetPitch = THREE.MathUtils.clamp(pitch * 0.6, -0.6, 0.6);
    // Fix reversed roll: tilting neck left should tilt avatar left
    targetRoll = THREE.MathUtils.clamp(-roll * 0.4, -0.5, 0.5);
  }
  
  // Apply smoothing to head tracking state (NOT targetRotation!)
  state.headTrackingState.yaw = THREE.MathUtils.lerp(state.headTrackingState.yaw, targetYaw, smoothing);
  state.headTrackingState.pitch = THREE.MathUtils.lerp(state.headTrackingState.pitch, targetPitch, smoothing);
  state.headTrackingState.roll = THREE.MathUtils.lerp(state.headTrackingState.roll, targetRoll, smoothing);
  state.headTrackingState.leftEyeOpenness = THREE.MathUtils.lerp(state.headTrackingState.leftEyeOpenness, leftEyeOpenness, 0.3);
  state.headTrackingState.rightEyeOpenness = THREE.MathUtils.lerp(state.headTrackingState.rightEyeOpenness, rightEyeOpenness, 0.3);
  state.headTrackingState.mouthOpenness = THREE.MathUtils.lerp(state.headTrackingState.mouthOpenness, mouthOpenness, 0.3);
  state.headTrackingState.mouthWidth = THREE.MathUtils.lerp(state.headTrackingState.mouthWidth, mouthWidth, 0.3);
}

// Apply head tracking to bones in render loop (called after vrm.update())
export function applyHeadTrackingToBones() {
  if (!state.vrm || !state.vrm.humanoid) return;

  const headBone = state.vrm.humanoid.getNormalizedBoneNode("head");
  const neckBone = state.vrm.humanoid.getNormalizedBoneNode("neck");

  if (!headBone || !neckBone) return;

  // Apply smoothed head tracking state to bones
  // This runs every frame in render loop, after vrm.update(), so it takes precedence
  headBone.rotation.y = state.headTrackingState.yaw;
  headBone.rotation.x = state.headTrackingState.pitch;
  headBone.rotation.z = state.headTrackingState.roll;
  neckBone.rotation.y = state.headTrackingState.yaw * 0.3;
  neckBone.rotation.x = state.headTrackingState.pitch * 0.3;
  neckBone.rotation.z = state.headTrackingState.roll * 0.3;

  // Apply face expressions for mirror mode
  if (state.config.headTrackingMode === "mirror" && state.vrm.expressionManager) {
    applyFaceTrackingToExpressions();
  }

  // Update lookAt target for follow mode
  if (state.config.headTrackingMode === "follow" && state.vrm.lookAt && state.vrm.lookAt.target) {
    if (state.vrm.lookAt.target instanceof THREE.Vector3) {
      // Look at target follows head orientation
      state.vrm.lookAt.target.set(
        Math.sin(state.headTrackingState.yaw) * 0.8,
        -state.headTrackingState.pitch * 0.6,
        2
      );
    }
  }
}

export function setExpressionWeight(name, value) {
  if (!state.vrm || !state.vrm.expressionManager) return;
  const e = state.vrm.expressionManager.getExpression(name);
  if (e) e.weight = value;
}

export function applyFaceTrackingToExpressions() {
  if (!state.vrm || !state.vrm.expressionManager) return;
  
  // Map eye openness to blink expressions (always apply in mirror mode)
  const avgEyeOpenness = (state.headTrackingState.leftEyeOpenness + state.headTrackingState.rightEyeOpenness) * 0.5;
  const blinkAmount = THREE.MathUtils.clamp(1 - avgEyeOpenness, 0, 1);
  
  setExpressionWeight("blink", blinkAmount);
  const leftBlink = THREE.MathUtils.clamp(1 - state.headTrackingState.leftEyeOpenness, 0, 1);
  const rightBlink = THREE.MathUtils.clamp(1 - state.headTrackingState.rightEyeOpenness, 0, 1);
  setExpressionWeight("blinkLeft", leftBlink);
  setExpressionWeight("blinkRight", rightBlink);
  setExpressionWeight("blink_l", leftBlink);
  setExpressionWeight("blink_r", rightBlink);
  
  // Map mouth openness to vowel expressions
  // Only apply face tracking mouth when lip sync is NOT active (low voice activity)
  const voiceThreshold = 0.15;
  const applyMouthTracking = state.currentVoiceActivity < voiceThreshold;
  
  if (applyMouthTracking) {
    if (state.headTrackingState.mouthOpenness > 0.1) {
      const open = state.headTrackingState.mouthOpenness;
      const wide = state.headTrackingState.mouthWidth;
      setExpressionWeight("aa", open * 0.8);
      setExpressionWeight("a", open * 0.8);
      setExpressionWeight("oh", open * 0.5);
      setExpressionWeight("o", open * 0.5);
      setExpressionWeight("ee", wide * 0.6);
      setExpressionWeight("e", wide * 0.4);
    } else {
      setExpressionWeight("aa", 0);
      setExpressionWeight("a", 0);
      setExpressionWeight("oh", 0);
      setExpressionWeight("o", 0);
      setExpressionWeight("ee", 0);
      setExpressionWeight("e", 0);
    }
  }
}

// Cleanup function for face mesh
export function stopFaceMesh() {
  if (state.faceMesh) {
    try { state.faceMesh.close(); } catch (e) {}
    state.faceMesh = null;
    state.faceMeshLoaded = false;
  }
  state.faceMeshLoadPromise = null;
  state.faceMeshResults = null;
  // Reset head tracking state
  state.headTrackingState = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    leftEyeOpenness: 1,
    rightEyeOpenness: 1,
    mouthOpenness: 0,
    mouthWidth: 0,
  };
  state.faceDetected = false;
}


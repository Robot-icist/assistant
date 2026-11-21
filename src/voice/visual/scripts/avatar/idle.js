import { state } from "./state.js";
import * as THREE from "three";

// ============ Idle Animations ============
export function updateIdleAnimations(deltaTime) {
  if (!state.config.idleEnabled || !state.vrm) return;

  state.idleTime += deltaTime;

  // Natural breathing - subtle chest movement (oscillating, not accumulating)
  if (state.config.breathingEnabled) {
    const chestBone = state.vrm.humanoid?.getNormalizedBoneNode("chest") || state.vrm.humanoid?.getNormalizedBoneNode("spine");
    if (chestBone) {
      const breathAmount = Math.sin(state.idleTime * state.config.breathingRate * Math.PI * 2) * state.config.breathingAmount;
      chestBone.rotation.x = THREE.MathUtils.lerp(chestBone.rotation.x, breathAmount, 0.1);
    }
  }

  // Subtle head sway - very gentle, natural movement (skip if head tracking is active)
  const trackingIdleAllowed = state.config.headTrackingMode === "off" || !state.faceDetected;
  if (state.config.headSwayEnabled && !state.config.showHeadOnly && trackingIdleAllowed) {
    const headBone = state.vrm.humanoid?.getNormalizedBoneNode("head");
    const neckBone = state.vrm.humanoid?.getNormalizedBoneNode("neck");
    if (headBone && neckBone) {
      const swayX = Math.sin(state.idleTime * state.config.headSwayRateX * Math.PI * 2) * state.config.headSwayAmountX;
      const swayY = Math.cos(state.idleTime * state.config.headSwayRateY * Math.PI * 2) * state.config.headSwayAmountY;
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, swayX, 0.05);
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, swayY, 0.05);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, swayX * state.config.neckSwayFactor, 0.05);
    }
  }

  // Micro movements - very subtle random drift for natural feel
  if (state.config.microMovementEnabled && !state.config.showHeadOnly && trackingIdleAllowed) {
    const headBone = state.vrm.humanoid?.getNormalizedBoneNode("head");
    const neckBone = state.vrm.humanoid?.getNormalizedBoneNode("neck");
    if (headBone && neckBone) {
      // Use a separate slow timer for micro movements
      const microTime = state.idleTime * state.config.microMovementRate;
      const microX = Math.sin(microTime * 1.7) * state.config.microMovementAmount;
      const microY = Math.cos(microTime * 1.3) * state.config.microMovementAmount;
      const microZ = Math.sin(microTime * 0.9) * state.config.microMovementAmount * 0.5;
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, microX, 0.02);
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, microY, 0.02);
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, microZ, 0.02);
      neckBone.rotation.x = THREE.MathUtils.lerp(neckBone.rotation.x, microX * 0.5, 0.02);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, microZ * 0.5, 0.02);
    }
  }

  // Natural blinking with double-blink support (skip during mirror face tracking to avoid fighting)
  const mirrorTrackingActive = state.headTrackingActive && state.config.headTrackingMode === "mirror" && state.faceDetected;
  if (state.config.blinkEnabled && !mirrorTrackingActive) {
    state.blinkTimer += deltaTime;
    
    if (state.blinkState === 0) {
      // Waiting for next blink
      if (state.blinkTimer >= state.nextBlinkTime) {
        state.blinkTimer = 0;
        state.nextBlinkTime = THREE.MathUtils.lerp(state.config.blinkMinInterval, state.config.blinkMaxInterval, Math.random());
        state.blinkState = 1; // Start closing
        // Determine if this will be a double blink
        state.isDoubleBlink = Math.random() < state.config.doubleBlinkChance;
      }
    } else if (state.blinkState === 1) {
      // Closing eyes
      const progress = Math.min(1, state.blinkTimer / state.config.blinkDuration);
      // Use ease-in for natural closing
      const easedProgress = progress * progress;
      setBlinkWeight(easedProgress);
      if (progress >= 1) {
        state.blinkTimer = 0;
        state.blinkState = 2; // Eyes closed
      }
    } else if (state.blinkState === 2) {
      // Holding eyes closed
      if (state.blinkTimer >= state.config.blinkHoldDuration) {
        state.blinkTimer = 0;
        if (state.isDoubleBlink) {
          state.blinkState = 4; // Double blink delay
        } else {
          state.blinkState = 3; // Start opening
        }
      }
    } else if (state.blinkState === 3) {
      // Opening eyes
      const progress = Math.min(1, state.blinkTimer / state.config.blinkDuration);
      // Use ease-out for natural opening
      const easedProgress = 1 - (1 - progress) * (1 - progress);
      setBlinkWeight(1 - easedProgress);
      if (progress >= 1) {
        state.blinkTimer = 0;
        state.blinkState = 0; // Back to waiting
      }
    } else if (state.blinkState === 4) {
      // Double blink delay - eyes stay open briefly
      if (state.blinkTimer >= state.config.doubleBlinkDelay) {
        state.blinkTimer = 0;
        state.blinkState = 1; // Second blink closing
        state.isDoubleBlink = false; // Only double blink once
      }
    }
  }
}

export function setBlinkWeight(weight) {
  if (!state.vrm || !state.vrm.expressionManager) return;
  const blinkExpr = state.vrm.expressionManager.getExpression("blink");
  if (blinkExpr) blinkExpr.weight = weight;
  const blinkLExpr = state.vrm.expressionManager.getExpression("blink_l");
  if (blinkLExpr) blinkLExpr.weight = weight;
  const blinkRExpr = state.vrm.expressionManager.getExpression("blink_r");
  if (blinkRExpr) blinkRExpr.weight = weight;
}


import { state } from "./state.js";
import { saveConfig } from "./config.js";

// ============ Arm Position Control ============
// VRM humanoid bone names (standardized in three-vrm)
export const ARM_BONE_NAMES = {
  leftShoulder: "leftShoulder",
  leftUpperArm: "leftUpperArm", 
  leftLowerArm: "leftLowerArm",
  rightShoulder: "rightShoulder",
  rightUpperArm: "rightUpperArm",
  rightLowerArm: "rightLowerArm",
};

export function applyArmPositions() {
  if (!state.vrm || !state.vrm.humanoid) return;

  Object.entries(state.config.armPositions).forEach(([key, value]) => {
    const boneName = ARM_BONE_NAMES[key];
    if (boneName && value) {
      const bone = state.vrm.humanoid.getNormalizedBoneNode(boneName);
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

export function setArmPosition(boneKey, x, y, z) {
  if (!state.vrm || !state.vrm.humanoid) return;

  const boneName = ARM_BONE_NAMES[boneKey];
  if (boneName) {
    const bone = state.vrm.humanoid.getNormalizedBoneNode(boneName);
    if (bone) {
      bone.rotation.x = x;
      bone.rotation.y = y;
      bone.rotation.z = z;
      state.config.armPositions[boneKey] = { x, y, z };
      saveConfig();
    } else {
      console.warn(`[Avatar] Cannot set arm position - bone not found: ${boneName}`);
    }
  }
}

// Debug: List available humanoid bones
export function debugListHumanoidBones() {
  if (!state.vrm || !state.vrm.humanoid) return;
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
    const bone = state.vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) console.log(`  ✓ ${name}`);
  });
}



import { state } from "./state.js";
import * as THREE from "three";
import { VRMLoaderPlugin } from "three-vrm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadModelConfig, saveConfig } from "./config.js";
import { applyArmPositions } from "./arms.js";
import { updateSettingsPanel } from "./windowManager.js";

// ============ VRM Loading ============
export async function loadVRM(url) {
  if (!url) {
    console.error("[Avatar] loadVRM called with undefined url, using default");
    url = "/models/fem_vroid.vrm";
  }
  // Load model-specific config before loading
  loadModelConfig(url);
  state.globalConfig.modelUrl = url;

  if (state.vrm) {
    state.scene.remove(state.vrm.scene);
    state.vrm.scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    if (state.mixer) state.mixer.uncacheRoot(state.vrm.scene);
    state.vrm = null;
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(url);
    state.vrm = gltf.userData.vrm;
    
    if (!state.vrm) {
      throw new Error("VRM not found in GLTF. Make sure the file is a valid VRM.");
    }
    
    state.scene.add(state.vrm.scene);

    // Initialize animation mixer
    state.mixer = new THREE.AnimationMixer(state.vrm.scene);

    // Scale and position (from model-specific config)
    state.vrm.scene.scale.setScalar(state.config.scale);
    state.vrm.scene.position.set(state.config.position.x, state.config.position.y, state.config.position.z);
    state.vrm.scene.rotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
    // Sync targetRotation/Position so render loop doesn't fight
    state.targetRotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
    state.targetPosition.set(state.config.position.x, state.config.position.y, state.config.position.z);

    // Play any built-in animations
    if (gltf.animations && gltf.animations.length > 0) {
      gltf.animations.forEach((clip) => {
        const action = state.mixer.clipAction(clip);
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
    return state.vrm;
  } catch (error) {
    console.error("Failed to load VRM:", error);
    throw error;
  }
}

export function setupVRM() {
  if (!state.vrm) return;

  // Enable look-at
  if (state.vrm.lookAt) {
    state.vrm.lookAt.autoUpdate = true;
    state.vrm.lookAt.eyesWeight = 1.0;
    state.vrm.lookAt.headWeight = 0.5;
    state.vrm.lookAt.bodyWeight = 0.2;
  }

  // Setup blink - disable auto blink so we can use our custom human-like blink system
  if (state.vrm.blink) {
    state.vrm.blink.autoUpdate = false;
  }

  // Setup spring bones for natural movement - exclude arm joints so manual arm positions work
  const armJointNames = new Set([
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"
  ]);
  if (state.vrm.springBoneManager) {
    state.vrm.springBoneManager.joints.forEach((joint) => {
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

export function applyExpressionWeights() {
  if (!state.vrm || !state.vrm.expressionManager) return;

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
    const expr = state.vrm.expressionManager.getExpression(exprName);
    if (expr) {
      expr.weight = 0;
    }
  });
}

export function updateHeadOnlyMode() {
  if (!state.vrm) return;

  const headBone = state.vrm.humanoid?.getNormalizedBoneNode("head");
  const neckBone = state.vrm.humanoid?.getNormalizedBoneNode("neck");

  // Head-related mesh name patterns (common in VRM models)
  const headMeshPatterns = [
    "head", "face", "hair", "eye", "eyelash", "eyebrow", "teeth", "tongue",
    "moustache", "beard", "glasses", "hat", "helmet", "ear", "earring"
  ];

  const isHeadMesh = (mesh) => {
    const name = mesh.name.toLowerCase();
    return headMeshPatterns.some(pattern => name.includes(pattern));
  };

  if (state.config.showHeadOnly) {
    // Save current full-body state before switching
    state.config.position = { x: state.vrm.scene.position.x, y: state.vrm.scene.position.y, z: state.vrm.scene.position.z };
    state.config.rotation = { x: state.vrm.scene.rotation.x, y: state.vrm.scene.rotation.y, z: state.vrm.scene.rotation.z };
    state.targetPosition.set(state.config.position.x, state.config.position.y, state.config.position.z);
    state.targetRotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
    
    // Save full-body camera state
    if (state.camera && state.controls) {
      const distance = state.camera.position.distanceTo(state.controls.target);
      const offset = new THREE.Vector3().subVectors(state.camera.position, state.controls.target);
      state.config.cameraDistance = distance;
      state.config.cameraHeight = state.camera.position.y;
      state.config.cameraTarget = { x: state.controls.target.x, y: state.controls.target.y, z: state.controls.target.z };
      state.config.cameraAzimuth = Math.atan2(offset.x, offset.z);
      state.config.cameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    }

    // Hide body parts, show only head/face meshes
    state.vrm.scene.traverse((node) => {
      if (node.isMesh || node.isSkinnedMesh) {
        node.visible = isHeadMesh(node);
      }
    });

    // Apply head-only position/rotation
    state.vrm.scene.position.set(state.config.headOnlyPosition.x, state.config.headOnlyPosition.y, state.config.headOnlyPosition.z);
    state.vrm.scene.rotation.set(state.config.headOnlyRotation.x, state.config.headOnlyRotation.y, state.config.headOnlyRotation.z);
    state.targetPosition.set(state.config.headOnlyPosition.x, state.config.headOnlyPosition.y, state.config.headOnlyPosition.z);
    state.targetRotation.set(state.config.headOnlyRotation.x, state.config.headOnlyRotation.y, state.config.headOnlyRotation.z);

    // Apply head-only camera
    if (state.camera && state.controls) {
      const distance = state.config.headOnlyCameraDistance;
      const azimuth = state.config.headOnlyCameraAzimuth;
      const polar = state.config.headOnlyCameraPolar;
      const target = state.config.headOnlyCameraTarget;

      state.controls.target.set(target.x, target.y, target.z);
      const sinPolar = Math.sin(polar);
      state.camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      state.camera.lookAt(target.x, target.y, target.z);
      state.controls.update();
    }
  } else {
    // Save head-only state before switching back
    state.config.headOnlyPosition = { x: state.vrm.scene.position.x, y: state.vrm.scene.position.y, z: state.vrm.scene.position.z };
    state.config.headOnlyRotation = { x: state.vrm.scene.rotation.x, y: state.vrm.scene.rotation.y, z: state.vrm.scene.rotation.z };
    if (state.camera && state.controls) {
      const distance = state.camera.position.distanceTo(state.controls.target);
      const offset = new THREE.Vector3().subVectors(state.camera.position, state.controls.target);
      state.config.headOnlyCameraDistance = distance;
      state.config.headOnlyCameraHeight = state.camera.position.y;
      state.config.headOnlyCameraTarget = { x: state.controls.target.x, y: state.controls.target.y, z: state.controls.target.z };
      state.config.headOnlyCameraAzimuth = Math.atan2(offset.x, offset.z);
      state.config.headOnlyCameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    }

    // Show all
    state.vrm.scene.traverse((node) => {
      if (node.isMesh || node.isSkinnedMesh) {
        node.visible = true;
      }
    });

    // Restore full-body position/rotation
    state.vrm.scene.position.set(state.config.position.x, state.config.position.y, state.config.position.z);
    state.vrm.scene.rotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
    state.targetPosition.set(state.config.position.x, state.config.position.y, state.config.position.z);
    state.targetRotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);

    // Restore full-body camera
    if (state.camera && state.controls) {
      const distance = state.config.cameraDistance;
      const azimuth = state.config.cameraAzimuth;
      const polar = state.config.cameraPolar;
      const target = state.config.cameraTarget;

      state.controls.target.set(target.x, target.y, target.z);
      const sinPolar = Math.sin(polar);
      state.camera.position.set(
        target.x + distance * sinPolar * Math.sin(azimuth),
        target.y + distance * Math.cos(polar),
        target.z + distance * sinPolar * Math.cos(azimuth)
      );
      state.camera.lookAt(target.x, target.y, target.z);
      state.controls.update();
    }
  }
  
  saveConfig();
}
export function applyConfig() {
  if (state.vrm) {
    // Apply position/rotation based on head-only mode
    if (state.config.showHeadOnly) {
      state.vrm.scene.scale.setScalar(state.config.scale);
      state.vrm.scene.position.set(state.config.headOnlyPosition.x, state.config.headOnlyPosition.y, state.config.headOnlyPosition.z);
      state.vrm.scene.rotation.set(state.config.headOnlyRotation.x, state.config.headOnlyRotation.y, state.config.headOnlyRotation.z);
      state.targetRotation.set(state.config.headOnlyRotation.x, state.config.headOnlyRotation.y, state.config.headOnlyRotation.z);
      state.targetPosition.set(state.config.headOnlyPosition.x, state.config.headOnlyPosition.y, state.config.headOnlyPosition.z);
    } else {
      state.vrm.scene.scale.setScalar(state.config.scale);
      state.vrm.scene.position.set(state.config.position.x, state.config.position.y, state.config.position.z);
      state.vrm.scene.rotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
      state.targetRotation.set(state.config.rotation.x, state.config.rotation.y, state.config.rotation.z);
      state.targetPosition.set(state.config.position.x, state.config.position.y, state.config.position.z);
    }
    updateHeadOnlyMode();
    applyArmPositions();
  }
  if (state.camera && state.controls) {
    // Restore camera state based on head-only mode
    let distance, azimuth, polar, target;
    
    if (state.config.showHeadOnly) {
      distance = state.config.headOnlyCameraDistance ?? 2.5;
      azimuth = state.config.headOnlyCameraAzimuth ?? 0;
      polar = state.config.headOnlyCameraPolar ?? Math.PI / 3;
      target = state.config.headOnlyCameraTarget ?? { x: 0, y: 1.6, z: 0 };
    } else {
      distance = state.config.cameraDistance ?? 3;
      azimuth = state.config.cameraAzimuth ?? 0;
      polar = state.config.cameraPolar ?? Math.PI / 3;
      target = state.config.cameraTarget ?? { x: 0, y: state.config.cameraHeight * 0.8, z: 0 };
    }

    // Set controls target first (pan position)
    state.controls.target.set(target.x, target.y, target.z);

    // Calculate camera position from spherical coordinates
    const sinPolar = Math.sin(polar);
    state.camera.position.set(
      target.x + distance * sinPolar * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * sinPolar * Math.cos(azimuth)
    );
    state.camera.lookAt(target.x, target.y, target.z);
    
    // Update controls to match
    state.controls.update();
  }
}


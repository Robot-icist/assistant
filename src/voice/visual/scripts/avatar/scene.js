import { state } from "./state.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadVRM } from "./vrm.js";
import { updateIdleAnimations } from "./idle.js";
import { updateLipSync } from "./lipSync.js";
import { applyArmPositions } from "./arms.js";
import { applyHeadTrackingToBones } from "./headTracking.js";
import { onWindowResize, scheduleResize } from "./resize.js";
import { saveConfig } from "./config.js";

// ============ Three.js Scene Setup ============
export function initThreeJS(canvas) {
  // Wait for canvas to have size
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    console.warn("[Avatar] Canvas has zero size, deferring init...");
    requestAnimationFrame(() => initThreeJS(canvas));
    return;
  }

  // Renderer
  state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  state.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); // false = don't update CSS style (flex handles it)
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Initialize lastKnownSize to prevent false resize on first check
  state.lastKnownSize = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
  };
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.shadowMap.enabled = true;

  // Scene
  state.scene = new THREE.Scene();
  // Don't set scene.background - leave it null so canvas alpha shows window background
  // The window div has the background color with opacity, canvas has alpha: true
  // scene.background = null; // default is null, so transparent
  // backgroundAlpha is not needed when background is null
  // scene.backgroundAlpha = globalConfig.windowOpacity ?? 0.95; // Only works with background color

  // Camera
  state.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  state.camera.position.set(0, state.config.cameraHeight, state.config.cameraDistance);
  state.camera.lookAt(0, state.config.cameraHeight * 0.8, 0);

  // Controls
  state.controls = new OrbitControls(state.camera, canvas);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.05;
  state.controls.enablePan = true;
  state.controls.enableZoom = true;
  state.controls.enableRotate = true;
  state.controls.minDistance = 1;
  state.controls.maxDistance = 10;
  // Restore saved camera target (pan) or default
  state.controls.target.set(
    state.config.cameraTarget?.x ?? 0,
    state.config.cameraTarget?.y ?? state.config.cameraHeight * 0.8,
    state.config.cameraTarget?.z ?? 0
  );

  // Save camera position/rotation when user interacts
  let saveDebounceTimer = null;
  function scheduleCameraSave() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      saveConfig();
    }, 300); // Debounce rapid changes
  }

  state.controls.addEventListener("change", () => {
    if (!state.config) return;
    
    // Save full camera state: distance, height, target (pan), and spherical angles
    const distance = state.camera.position.distanceTo(state.controls.target);
    const offset = new THREE.Vector3().subVectors(state.camera.position, state.controls.target);
    
    if (state.config.showHeadOnly) {
      // Save to head-only camera config
      state.config.headOnlyCameraDistance = distance;
      state.config.headOnlyCameraHeight = state.camera.position.y;
      state.config.headOnlyCameraTarget = { 
        x: state.controls.target.x, 
        y: state.controls.target.y, 
        z: state.controls.target.z 
      };
      state.config.headOnlyCameraAzimuth = Math.atan2(offset.x, offset.z); // theta
      state.config.headOnlyCameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1)); // phi
    } else {
      // Save to full-body camera config
      state.config.cameraDistance = distance;
      state.config.cameraHeight = state.camera.position.y;
      state.config.cameraTarget = { 
        x: state.controls.target.x, 
        y: state.controls.target.y, 
        z: state.controls.target.z 
      };
      state.config.cameraAzimuth = Math.atan2(offset.x, offset.z); // theta
      state.config.cameraPolar = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1)); // phi
    }
    
    scheduleCameraSave();
  });
  state.controls.addEventListener("end", () => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveConfig();
  });

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  state.scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 7);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  state.scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 5, -5);
  state.scene.add(fillLight);

  // Ground plane (invisible, for shadows)
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  state.scene.add(ground);

  // Load initial model
  const modelUrl = state.globalConfig.modelUrl || "/models/fem_vroid.vrm";
  console.log("[Avatar] Loading model:", modelUrl);
  loadVRM(modelUrl).catch((err) => {
    console.error("[Avatar] Failed to load initial model:", err);
  });

  // Handle canvas resize - observe the canvasContainer (which actually changes size)
  if (state.resizeObserver) {
    state.resizeObserver.disconnect();
  }
  state.resizeObserver = new ResizeObserver(() => {
    try { scheduleResize(); } catch (e) { console.error("[Avatar] ResizeObserver error:", e); }
  });
  // Observe canvasContainer - it's the flex child that actually resizes
  const canvasContainer = state.avatarCanvas.parentElement;
  if (canvasContainer) {
    state.resizeObserver.observe(canvasContainer);
  }
  // Also observe canvas as fallback
  state.resizeObserver.observe(state.avatarCanvas);

  // Start animation loop
  animate();
}

export function animate() {
  try {
    // Skip rendering if canvas is not visible (minimized/hidden)
    if (state.avatarCanvas && (state.avatarCanvas.offsetWidth === 0 || state.avatarCanvas.offsetHeight === 0 || state.avatarCanvas.style.display === "none" || !document.body.contains(state.avatarCanvas))) {
      state.animationId = requestAnimationFrame(animate);
      return;
    }

    // Check for WebGL context loss
    if (state.renderer && state.renderer.getContext()) {
      const gl = state.renderer.getContext();
      if (gl.isContextLost()) {
        console.warn("[Avatar] WebGL context lost, attempting to restore...");
        // Force context restoration attempt
        try {
          state.renderer.dispose();
        } catch (e) {}
        state.renderer = null;
      }
    }

    const deltaTime = Math.min(state.clock.getDelta(), 0.1); // Clamp to prevent large jumps

    // Fallback: check if canvas drawing buffer size changed (in case ResizeObserver missed it)
    if (state.avatarCanvas && state.renderer) {
      // Compare drawing buffer sizes (canvas.width/height), not CSS vs drawing buffer
      const expectedWidth = Math.floor(state.avatarCanvas.clientWidth * state.renderer.getPixelRatio());
      const expectedHeight = Math.floor(state.avatarCanvas.clientHeight * state.renderer.getPixelRatio());
      if (expectedWidth > 0 && expectedHeight > 0 && 
          (expectedWidth !== state.avatarCanvas.width || expectedHeight !== state.avatarCanvas.height)) {
        console.log("[Avatar] Drawing buffer size mismatch detected, resizing:", expectedWidth, "x", expectedHeight);
        onWindowResize();
      }
    }

    // Update animation mixer
    if (state.mixer) {
      state.mixer.update(deltaTime);
    }

    // Update VRM
    if (state.vrm && state.vrm.scene) {
      state.vrm.update(deltaTime);
      updateIdleAnimations(deltaTime);
      updateLipSync(deltaTime);

      // Apply arm positions AFTER vrm.update() so they're not overwritten by spring bones/animations
      applyArmPositions();

      // Apply head tracking to bones AFTER vrm.update() so it takes precedence over lookAt/spring bones
      if (state.headTrackingActive && state.config.headTrackingMode !== "off" && state.faceDetected) {
        applyHeadTrackingToBones();
      }

      // Always sync scene position and rotation to targetPosition/targetRotation
      // (targetPosition/targetRotation are kept in sync with config via sliders/buttons/loadVRM)
      // This ensures position/rotation persists and is restored on reload
      state.vrm.scene.position.lerp(state.targetPosition, 0.1);
      
      // Smoothly interpolate all rotation components, not just Y
      state.vrm.scene.rotation.x = THREE.MathUtils.lerp(state.vrm.scene.rotation.x, state.targetRotation.x, 0.1);
      state.vrm.scene.rotation.y = THREE.MathUtils.lerp(state.vrm.scene.rotation.y, state.targetRotation.y, 0.1);
      state.vrm.scene.rotation.z = THREE.MathUtils.lerp(state.vrm.scene.rotation.z, state.targetRotation.z, 0.1);
    }

    // Update controls
    if (state.controls) state.controls.update();

    // Render
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
      
      // Check for context loss after render
      if (state.renderer.getContext() && state.renderer.getContext().isContextLost()) {
        console.warn("[Avatar] Context lost detected after render");
        throw new Error("WebGL context lost after render");
      }
    }

    // Frame logging (every 5 seconds)
    state.frameCount++;
    const now = performance.now();
    if (now - state.lastLogTime > 5000) {
      console.log(`[Avatar] Frame ${state.frameCount}, deltaTime: ${deltaTime.toFixed(4)}, renderer: ${state.renderer ? 'ok' : 'null'}, vrm: ${state.vrm ? 'ok' : 'null'}`);
      state.lastLogTime = now;
    }
  } catch (error) {
    console.error("[Avatar] Render loop error:", error);
    // Attempt recovery for ANY error - be aggressive
    console.warn("[Avatar] Attempting full recovery...");
    if (state.renderer) {
      try { state.renderer.dispose(); } catch (e) {}
      state.renderer = null;
    }
    if (state.avatarCanvas) {
      // Re-init Three.js on next frame
      setTimeout(() => {
        if (state.avatarCanvas && !state.renderer && document.body.contains(state.avatarCanvas)) {
          try {
            initThreeJS(state.avatarCanvas);
            if (state.vrm && state.vrm.scene) {
              state.scene.add(state.vrm.scene);
            }
            console.log("[Avatar] Recovery successful");
          } catch (e) {
            console.error("[Avatar] Recovery failed:", e);
          }
        }
      }, 100);
    }
  }

  state.animationId = requestAnimationFrame(animate);
}


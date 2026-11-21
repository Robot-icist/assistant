import { state } from "./state.js";

// MediaPipe Face Mesh for reliable face tracking
export async function loadFaceMesh() {
  if (state.faceMeshLoaded && state.faceMesh) return;
  if (state.faceMeshLoadPromise) return state.faceMeshLoadPromise;
  
  state.faceMeshLoadPromise = (async () => {
    try {
      // Load MediaPipe Face Mesh via script tag (Closure Library build registers FaceMesh globally)
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js";
        script.crossOrigin = "anonymous";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load MediaPipe Face Mesh script"));
        document.head.appendChild(script);
      });
      
      // FaceMesh is now available globally
      if (typeof FaceMesh === 'undefined') {
        throw new Error("FaceMesh not found in global scope after script load");
      }
      
      state.faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
      });
      state.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.3,
        minTrackingConfidence: 0.3
      });
      state.faceMeshLoaded = true;
      console.log("[Avatar] MediaPipe Face Mesh loaded");
    } catch (e) {
      console.error("[Avatar] Failed to load MediaPipe Face Mesh:", e);
      state.faceMeshLoaded = false;
      state.faceMeshLoadPromise = null;
      throw e;
    }
  })();
  
  return state.faceMeshLoadPromise;
}


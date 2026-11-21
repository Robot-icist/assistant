import { state } from "./state.js";


export function onWindowResize() {
  if (!state.avatarCanvas || !state.renderer || !state.camera) return;
  
  // Get size from canvasContainer (the flex child that actually resizes)
  const canvasContainer = state.avatarCanvas.parentElement;
  if (!canvasContainer) {
    console.warn("[Avatar] onWindowResize: no canvasContainer");
    return;
  }
  
  const width = canvasContainer.clientWidth;
  const height = canvasContainer.clientHeight;
  
  if (width === 0 || height === 0) {
    // Canvas might be hidden/minimized, skip resize
    return;
  }
  
  // Use device pixel ratio (capped for performance)
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  
  // Check if size actually changed (avoid unnecessary GPU work)
  // Compare CSS size + pixelRatio, not drawing buffer
  if (state.lastKnownSize.width === width && 
      state.lastKnownSize.height === height && 
      state.lastKnownSize.pixelRatio === pixelRatio) {
    return; // No actual change
  }
  
  state.lastKnownSize = { width, height, pixelRatio };
  
  // Let three.js handle drawing buffer via pixelRatio
  // Don't manually set canvas.width/height - renderer.setSize + setPixelRatio does it correctly
  state.renderer.setSize(width, height, false); // false = don't update CSS style (flex handles it)
  state.renderer.setPixelRatio(pixelRatio);
  
  // Update camera aspect to match CSS aspect ratio (not drawing buffer)
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  
  const drawingWidth = Math.floor(width * pixelRatio);
  const drawingHeight = Math.floor(height * pixelRatio);
  console.log("[Avatar] Resize:", width, "x", height, "@", pixelRatio, "=>", drawingWidth, "x", drawingHeight);
}

// Debounced resize handler for ResizeObserver (avoids excessive calls during drag)
export function scheduleResize() {
  if (state.resizeFrameId) return;
  state.resizeFrameId = requestAnimationFrame(() => {
    state.resizeFrameId = null;
    onWindowResize();
  });
}



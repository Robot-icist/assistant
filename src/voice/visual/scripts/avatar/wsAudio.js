import { state } from "./state.js";
import { setupAudioAnalysis } from "./lipSync.js";

// ============ WebSocket Audio Integration ============
// Use WS.addCallback to receive raw audio buffers directly for lip sync

export function subscribeToWebSocketAudio() {
  // Remove previous callback if any
  if (state.wsAudioCallbackId !== null) {
    state.wsAudioCallbackId = null;
  }

  if (typeof WS !== "undefined" && typeof WS.addCallback === "function") {
    state.wsAudioCallbackId = WS.addCallback((data, isBinary, type) => {
      // Handle binary audio data (WAV/MP3) - use as trigger to hook into existing audio element
      if (isBinary && type && type.startsWith("audio")) {
        console.log("[Avatar] Audio received via WS, hooking into #audio element for lip sync");
        // Small delay to let websockethandler create the <audio> element
        setTimeout(() => {
          const audioEl = document.getElementById("audio");
          if (audioEl && audioEl !== state.mediaElement) {
            setupAudioAnalysis(audioEl);
          }
        }, 50);
      }
    });
    console.log("[Avatar] Registered WS.addCallback for audio lip sync");
  } else {
    // WS not ready yet, retry after a short delay
    setTimeout(subscribeToWebSocketAudio, 500);
  }
}


const styles = `
  .spinner {
    display: inline-block;
    width: 8px;
    height: 8px;
    border: 2px solid rgb(255, 255, 255);
    border-top: 2px solid rgb(0, 0, 0);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    vertical-align: middle;
    margin-bottom: 2px;
    margin-right: 5px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .silence {
    color: #666;
    background-color: #f3f3f3;
    font-size: 13px;
    border-radius: 30px;
    padding: 2px 10px;
  }

  .loading {
    color: #666;
    background-color: #ff4d4d0f;
    border-radius: 8px 8px 8px 0px;
    padding: 2px 10px;
    font-size: 14px;
    margin-bottom: 0px;
  }

  #speaker {
    border: 1px solid rgb(229, 229, 229);
    border-radius: 100px;
    padding: 2px 10px;
    font-size: 14px;
    margin-bottom: 0px;
  }

  .label_diarization {
    background-color: #ffffff66;
    border-radius: 8px 8px 8px 8px;
    padding: 2px 10px;
    margin-left: 10px;
    font-size: 14px;
    margin-bottom: 0px;
    color: rgb(134, 134, 134);
  }

  .label_transcription {
    background-color: #ffffff66;
    border-radius: 8px 8px 8px 8px;
    padding: 2px 10px;
    margin-left: 10px;
    font-size: 14px;
    margin-bottom: 0px;
    color:rgb(0, 0, 0);
  }

  #timeInfo {
    color:rgb(255, 255, 255);
    margin-left: 10px;
  }

  .textcontent {
    font-size: 16px;
    padding-left: 10px;
    margin-bottom: 10px;
    margin-top: 1px;
    padding-top: 5px;
    border-radius: 0px 0px 0px 10px;
  }

  .buffer_diarization {
    color: rgb(134, 134, 134);
    margin-left: 4px;
  }

  .buffer_transcription {
    color:rgba(255, 255, 255, 0.43);
    margin-left: 4px;
  }
`;

const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

let isRecording = false;
let websocket = null;
let recorder = null;
let chunkDuration = 500;
let websocketUrl = null;
if (pageKite) websocketUrl = `wss://whisper-${subdomain}.pagekite.me/asr`;
else websocketUrl = `wss://whisper${subdomain}.loca.lt/asr`;
let userClosing = false;
let displayTimeout = 10000;
let fontFamily = "Doto";
let timeout = null;
let callback = null;
// Add a flag to prevent multiple connection attempts.
let isConnecting = false;

function setupWebSocket() {
  return new Promise((resolve, reject) => {
    // Check if a connection is already in progress or if a websocket exists
    if (isConnecting || websocket) {
      console.log("WebSocket connection already in progress or exists.");
      return resolve(); // Resolve immediately if connecting or connected
    }

    isConnecting = true; // Set the flag to indicate connection in progress

    try {
      websocket = new WebSocket(websocketUrl);
    } catch (error) {
      console.error("Invalid WebSocket URL:", error);
      isConnecting = false; // Reset the flag on error
      reject(error);
      return;
    }

    websocket.onopen = () => {
      console.log("Connected to server.");
      isConnecting = false; // Reset the flag on successful connection
      resolve();
    };

    websocket.onclose = async () => {
      const message = userClosing
        ? "WebSocket closed by user."
        : "Disconnected from the WebSocket server.";
      console.log(message);
      if (userClosing) return;
      userClosing = false;
      delete websocket;
      websocket = null; // Ensure websocket is nullified on close
      isConnecting = false; // Reset the flag
      stopRecording(); // Stop recording on close
      // Reconnect logic:  Wait and then attempt reconnection
      setTimeout(async () => {
        // if (!isRecording) {
        //   //Only reconnect if we are supposed to be recording (after the initial toggle)
        //   return;
        // }
        console.log("Attempting to reconnect...");
        await setupWebSocket();
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          console.log("Successfully reconnected.");
          // Optionally restart recording here if needed
          await startRecording();
        } else {
          console.log("Reconnection failed.");
        }
      }, 1000);
    };

    websocket.onerror = async (error) => {
      console.error("Error connecting to WebSocket:", error);
      isConnecting = false; // Reset the flag on error
      stopRecording(); // Stop recording on close
      //   reject(new Error("Error connecting to WebSocket"));
      delete websocket;
      websocket = null;
    };

    websocket.onmessage = (event) => {
      clearTimeout(timeout);
      const data = JSON.parse(event.data);
      console.log("Received data:", data);
      const {
        lines = [],
        buffer_transcription = "",
        buffer_diarization = "",
        remaining_time_transcription = 0,
        remaining_time_diarization = 0,
      } = data;

      // Generate the HTML string
      let displayHTML = "";
      let plainText = "";

      lines.forEach((item, idx) => {
        let timeInfo =
          item.beg !== undefined && item.end !== undefined
            ? ` ${item.beg} - ${item.end}`
            : "";

        let speakerLabel = "";

        if (item.speaker === -2) {
          speakerLabel = `<span class="silence">Silence<span id='timeInfo'>${timeInfo}</span></span>`;
        } else if (item.speaker === 0) {
          speakerLabel = `<span class='loading'><span class="spinner"></span><span id='timeInfo'>${remaining_time_diarization} second(s) of audio are undergoing diarization</span></span>`;
        } else if (item.speaker == -1) {
          speakerLabel = `<span id="speaker"><span id='timeInfo'>${timeInfo}</span></span>`;
        } else if (item.speaker !== -1) {
          speakerLabel = `<span id="speaker">Speaker ${item.speaker}<span id='timeInfo'>${timeInfo}</span></span>`;
        }

        let textContent = item.text;

        if (idx === lines.length - 1) {
          if (buffer_diarization) {
            speakerLabel += `<span class="label_diarization"><span class="spinner"></span>Diarization lag<span id='timeInfo'>${remaining_time_diarization}s</span></span>`;
            textContent += `<span class="buffer_diarization">${buffer_diarization}</span>`;
          }
          if (buffer_transcription) {
            speakerLabel += `<span class="label_transcription"><span class="spinner"></span>Transcription lag <span id='timeInfo'>${remaining_time_transcription}s</span></span>`;
            textContent += `<span class="buffer_transcription">${buffer_transcription}</span>`;
          }
        }

        if (textContent) {
          displayHTML += `${speakerLabel}<br/><div class='textcontent'>${textContent}</div><br>`; // Added <br> for spacing
          plainText += textContent + " "; // Accumulate plain text

          timeout = setTimeout(() => {
            callback(textContent);
          }, 2500);
        }
      });

      // Call displayText with HTML content
      displayText(
        displayHTML,
        displayTimeout,
        fontFamily,
        false,
        "text-display",
        true
      );
    };
  });
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(e.data);
      }
    };
    recorder.start(chunkDuration);
    isRecording = true;
  } catch (err) {
    console.error("Error accessing microphone:", err);
  }
}

function stopRecording() {
  userClosing = true;
  if (recorder) {
    recorder.stop();
    recorder = null;
  }
  isRecording = false;

  if (websocket) {
    websocket.close();
    websocket = null;
  }
}

async function toggleRecording(cb) {
  callback = cb;
  if (!isRecording) {
    try {
      await setupWebSocket();
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        await startRecording();
      } else {
        console.warn("WebSocket not open, recording not started.");
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  } else {
    stopRecording();
  }
}

// // Initialization
// (async () => {
//   await toggleRecording(); // Start recording initially
// })();

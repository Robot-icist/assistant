import { changeColor, getParams, stopMediaStream } from "./icosahedron.js";

export const sendParams = (text = null) => {
  const params = getParams();
  WS.send(
    JSON.stringify({
      text: text,
      lang: params.model.split("-")[3],
      speaker: params.speaker,
      hotword: params.wakeword.toLowerCase(),
      video: params.video,
      google: params.google,
      llmProvider: params.llmProvider,
      llm: params.llm,
      keepInMemory: params.keepInMemory,
      D3: params.D3,
    })
  );
};

export const stopPlaying = () => {
  stopMediaStream();
  document.getElementById("audio")?.remove();
  document.getElementById("video")?.remove();
  // if (window.Avatar && typeof window.Avatar.stop === "function") window.Avatar.stop();
  WS.playNextMedia();
};

export const stopProcessing = () => {
  WS.clearMediaQueue();
  // if (window.Avatar && typeof window.Avatar.clear === "function") window.Avatar.clear();
  stopPlaying();
  stopRecognition();
  document.getElementById("loader")?.remove();
  document.getElementById("stop")?.remove();
  sendParams("stop");
};

const listenForTextInput = () => {
  let textBuffer = "";
  document.addEventListener("keydown", async (event) => {
    console.log("keydown", event);
    hideLLMText();
    if (
      event.key.length == 1 &&
      // event.key != "Alt" &&
      // event.key != "Unidentified" &&
      // event.key != "Backspace" &&
      // event.key != "Enter" &&
      // event.key != "AudioVolumeUp" &&
      // event.key != "AudioVolumeDown" &&
      // event.key != "AltGraph" &&
      // event.key != "ArrowLeft" &&
      // event.key != "ArrowRight" &&
      // event.key != "ArrowUp" &&
      // event.key != "ArrowDown" &&
      // event.key != "NumLock" &&
      // event.key != "Delete" &&
      // event.key != "Insert" &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      textBuffer += event.key;
      displayText(textBuffer);
    } else if (event.key === "Backspace") {
      textBuffer = textBuffer.slice(0, -1);
      displayText(textBuffer);
    } else if (event.key === "Enter" && textBuffer.trim() !== "") {
      if (
        textBuffer.toLowerCase().includes("vois") ||
        textBuffer.toLowerCase().includes("see")
      ) {
        sendParams();
        let front =
          textBuffer.toLowerCase().includes("devant") ||
          textBuffer.toLowerCase().includes("front");

        await takePicture(front ? "user" : "environment");
      }
      else if (
        textBuffer.toLowerCase().includes("recognition") ||
        textBuffer.toLowerCase().includes("reconnaissance")
      ) {
        sendParams();
        let front =
          textBuffer.toLowerCase().includes("devant") ||
          textBuffer.toLowerCase().includes("front");
        await startRecognition(front ? "user" : "environment");
      } else if (textBuffer.toLowerCase().includes("stop")) {
        stopProcessing();
      } else {
        sendParams(textBuffer.trim());
      }
      textBuffer = "";
      displayText(textBuffer);
    }
  });
};

listenForTextInput();

const enableVirtualKeyboard = () => {
  if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return; // Only for mobile

  window.addEventListener("load", () => {
    document.getElementsByTagName("canvas")[0].addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.style.position = "absolute";
      input.style.opacity = "0";
      input.style.pointerEvents = "none";
      input.setAttribute("autocorrect", "off");
      input.setAttribute("autocomplete", "off");
      input.setAttribute("spellcheck", "false");

      document.body.prepend(input); // move it to the top of the body
      input.focus();

      // Ensures key events are dispatched correctly for "Enter" and other keys.
      input.addEventListener("input", (event) => {
        console.log("input", event);
        let data = event.data || "";
        const key = data;
        // event.inputType == "deleteContentBackward" ? "Backspace" : data;
        if (key) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key }));
        }
      });

      // input.addEventListener("keydown", (event) => {
      //   document.dispatchEvent(new KeyboardEvent("keydown", { ...event }));
      // });

      // input.addEventListener("keyup", (event) => {
      //   document.dispatchEvent(new KeyboardEvent("keydown", { ...event }));
      // });

      input.addEventListener("blur", () => {
        document.body.removeChild(input);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });
    });
  });
};

enableVirtualKeyboard();

// Function to request permission for notifications
function requestNotificationPermission() {
  if (Notification.permission === "granted") {
  } else if (Notification.permission !== "denied") {
    // If permission is not denied, request permission
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
      } else {
        alert("Notification permission denied.");
      }
    });
  }
}
requestNotificationPermission();

let loading = false;
window.addEventListener("load", () => {
  sendParams();
  WS.events.subscribe("connected", () => changeColor("deepskyblue"));
  WS.events.subscribe("disconnected", () => changeColor("grey"));
  WS.events.subscribe("loading", () => {
    loading = true;
    showLoader();
    createStopButton(stopProcessing);
  });
  WS.events.subscribe("unloading", () => {
    loading = false;
    hideLoader();
    if (WS.mediaQueue.length == 0) hideStopButton();
  });
  WS.events.subscribe("playing", () => createStopButton(stopProcessing));
  WS.events.subscribe("played", () => {
    if (!loading && WS.mediaQueue.length == 0) hideStopButton();
  });
  WS.events.subscribe("stop", () => {
    WS.clearMediaQueue();
    stopPlaying();
    if (!loading) hideStopButton();
    // changeColor(getParams().alwaysOn ? "gold" : "deepskyblue");
  });
  document.getElementsByTagName("canvas")[0].addEventListener("click", () => {
    stopPlaying();
    if (!loading && WS.mediaQueue.length == 0) hideStopButton();
    hideText();
    hideLLMText();
  });

  // Create avatar toggle button
  createAvatarToggleButton();
});

function createAvatarToggleButton() {
  const btn = document.createElement("button");
  btn.id = "avatar-toggle-btn";
  btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
  btn.title = "Toggle VRM Avatar (A)";
  btn.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: linear-gradient(145deg, #2a2a3e, #1a1a2e);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 24px;
    cursor: pointer;
    z-index: 9999;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  `;
  btn.onmouseenter = () => {
    btn.style.transform = "scale(1.1)";
    btn.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.6)";
    btn.style.background = "linear-gradient(145deg, #3a3a4e, #2a2a3e)";
  };
  btn.onmouseleave = () => {
    btn.style.transform = "scale(1)";
    btn.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.5)";
    btn.style.background = "linear-gradient(145deg, #2a2a3e, #1a1a2e)";
  };
  btn.onclick = () => {
    if (window.Avatar) {
      const win = document.getElementById("avatar-window");
      if (win && win.style.display !== "none") {
        window.Avatar.hide();
      } else if (win) {
        window.Avatar.show();
      } else {
        window.Avatar.init();
      }
    }
  };
  document.body.appendChild(btn);
}

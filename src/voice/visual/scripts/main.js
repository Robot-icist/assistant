import { changeColor, getParams, stopMediaStream } from "./icosahedron.js";

export const sendParams = (text = null) => {
  const params = getParams();
  WS.send(
    JSON.stringify({
      text: text,
      lang: params.model.includes("fr") ? "fr" : "en",
      speaker: params.speaker,
      video: params.video,
      google: params.google,
      llm: params.llm,
      keepInMemory: params.keepInMemory,
    })
  );
};

export const stopPlaying = () => {
  stopMediaStream();
  document.getElementById("audio")?.remove();
  document.getElementById("video")?.remove();
  WS.playNextMedia();
};

export const stopProcessing = () => {
  stopPlaying();
  WS.mediaQueue = [];
  document.getElementById("loader")?.remove();
  document.getElementById("stop")?.remove();
  sendParams("stop");
};

const listenForTextInput = () => {
  let textBuffer = "";
  document.addEventListener("keydown", async (event) => {
    console.log(event);
    hideLLMText();
    if (
      event.key &&
      event.key != "Unidentified" &&
      event.key != "Backspace" &&
      event.key != "Enter" &&
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
        console.log(event);
        let data = event.data || "";
        const key =
          event.inputType == "deleteContentBackward" ? "Backspace" : data;
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

window.addEventListener("load", () => {
  sendParams();
  WS.events.subscribe("connected", () => changeColor("deepskyblue"));
  WS.events.subscribe("disconnected", () => changeColor("grey"));
  WS.events.subscribe("loading", () => {
    showLoader();
    createStopButton(stopProcessing);
  });
  WS.events.subscribe("unloading", () => {
    hideLoader();
    hideStopButton();
  });
  WS.events.subscribe("playing", () => createStopButton(stopProcessing));
  WS.events.subscribe("played", () => hideStopButton());
  WS.events.subscribe("stop", () => {
    WS.mediaQueue = [];
    stopPlaying();
    hideStopButton();
  });
  document.getElementsByTagName("canvas")[0].addEventListener("click", (e) => {
    e.preventDefault();
    stopPlaying();
    hideStopButton();
  });
});

import { changeColor, getParams } from "./icosahedron.js";

const listenForTextInput = () => {
  let textBuffer = "";
  document.addEventListener("keydown", async (event) => {
    console.log(event);
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      textBuffer += event.key;
      displayText(textBuffer);
    } else if (event.key === "Backspace") {
      textBuffer = textBuffer.slice(0, -1);
      displayText(textBuffer);
    } else if (event.key === "Enter" && textBuffer.trim() !== "") {
      const params = getParams();
      if (
        textBuffer.toLowerCase().includes("vois") ||
        textBuffer.toLowerCase().includes("see")
      ) {
        sendParams();
        let front =
          textBuffer.toLowerCase().includes("devant") ||
          textBuffer.toLowerCase().includes("front");

        return await takePicture(front ? "user" : "environment");
      } else {
        WS.send(
          JSON.stringify({
            text: textBuffer.trim(),
            lang: params.model.includes("fr") ? "fr" : "en",
            speaker: params.speaker,
            video: params.video,
            google: params.google,
          })
        );
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

      document.body.prepend(input); // move it to the top of the body
      input.focus();

      // Ensures key events are dispatched correctly for "Enter" and other keys.
      input.addEventListener("input", (event) => {
        const key = event.data || ""; // Get the typed character
        if (key) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key }));
        }
      });

      input.addEventListener("keydown", (event) => {
        document.dispatchEvent(new KeyboardEvent("keydown", { ...event }));
      });

      input.addEventListener("keyup", (event) => {
        document.dispatchEvent(new KeyboardEvent("keydown", { ...event }));
      });

      input.addEventListener("blur", () => {
        document.body.removeChild(input);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });
    });
  });
};

enableVirtualKeyboard();

export const sendParams = () => {
  const params = getParams();
  WS.send(
    JSON.stringify({
      lang: params.model.includes("fr") ? "fr" : "en",
      speaker: params.speaker,
      video: params.video,
      google: params.google,
    })
  );
};

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

window.addEventListener("load", async () => {
  sendParams();
  WS.events.subscribe("connected", () => changeColor("deepskyblue"));
  WS.events.subscribe("disconnected", () => changeColor("grey"));
});

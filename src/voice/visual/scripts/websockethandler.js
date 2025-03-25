class WebSocketHandler {
  constructor(url) {
    this.url = url;
    this.callbacks = [];
    this.ws = null;
    this.reconnectInterval = 3000;
    this.mediaQueue = [];
    this.isPlaying = false;
    this.addCallback = this.addCallback;
    this.send = this.send;
    this.events = new EventEmitter();
    this.playNextMedia = this.playNextMedia;
    this.initWebSocket();
  }

  initWebSocket() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.events.emit("connected");
      // new Notification("Websocket", { body: "Connected" });
      console.log("WebSocket connected");
    };
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = (error) => console.error("WebSocket error:", error);
    this.ws.onclose = () => {
      this.events.emit("disconnected");
      console.log("WebSocket closed. Reconnecting...");
      setTimeout(() => this.initWebSocket(), this.reconnectInterval);
    };
  }

  send(data) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  addCallback(cb) {
    this.callbacks.push(cb);
  }

  handleMessage(event) {
    if (typeof event.data === "string") {
      if (event.data.includes("text:")) {
        hideText();
        displayText(
          event.data.split("text:").pop(),
          7500,
          "Silkscreen",
          true,
          "text-display-llm"
        );
      }
      if (event.data.includes("loading:")) {
        let loading = event.data.split("loading:").pop();
        this.events.emit(loading == "true" ? "loading" : "unloading");
      }
      if (event.data.includes("stop:")) {
        this.events.emit("stop");
      }
      if (this.callbacks.length > 0)
        for (let cb of this.callbacks) {
          cb(event.data, false);
        }
    } else if (event.data instanceof ArrayBuffer) {
      this.processBinaryData(event.data);
    }
  }

  processBinaryData(buffer) {
    const byteArray = new Uint8Array(buffer);

    if (this.isWav(byteArray)) {
      this.enqueueMedia(buffer, "audio/wav");
    } else if (this.isMp4(byteArray)) {
      this.enqueueMedia(buffer, "video/mp4");
    } else if (this.isImage(byteArray)) {
      this.enqueueMedia(buffer, this.getImageMimeType(byteArray));
    } else {
      console.warn("Unknown binary format received");
    }
  }

  isWav(byteArray) {
    return (
      byteArray[0] === 0x52 &&
      byteArray[1] === 0x49 &&
      byteArray[2] === 0x46 &&
      byteArray[3] === 0x46
    );
  }

  isMp4(byteArray) {
    return (
      byteArray[4] === 0x66 &&
      byteArray[5] === 0x74 &&
      byteArray[6] === 0x79 &&
      byteArray[7] === 0x70
    );
  }

  isImage(byteArray) {
    return this.getImageMimeType(byteArray) !== null;
  }

  getImageMimeType(byteArray) {
    const signatures = {
      "image/jpeg": [0xff, 0xd8, 0xff],
      "image/png": [0x89, 0x50, 0x4e, 0x47],
      "image/gif": [0x47, 0x49, 0x46, 0x38],
      "image/bmp": [0x42, 0x4d],
      "image/webp": [0x52, 0x49, 0x46, 0x46],
    };

    for (const [mime, signature] of Object.entries(signatures)) {
      if (
        byteArray
          .slice(0, signature.length)
          .every((byte, index) => byte === signature[index])
      ) {
        return mime;
      }
    }
    return null;
  }

  enqueueMedia(buffer, type) {
    this.mediaQueue.push({ buffer, type });
    if (!this.isPlaying) {
      this.playNextMedia();
    }
  }

  playNextMedia() {
    if (this.mediaQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    WS.events.emit("playing");
    const { buffer, type } = this.mediaQueue.shift();
    const blob = new Blob([buffer], { type });
    const url = URL.createObjectURL(blob);

    if (this.callbacks.length > 0)
      for (let cb of this.callbacks) {
        cb(buffer, true, type);
      }

    let mediaElement;
    if (type.startsWith("audio")) {
      document.getElementById("audio")?.remove();
      mediaElement = document.createElement("audio");
      mediaElement.id = "audio";
      mediaElement.controls = true;
      mediaElement.autoplay = true;
      mediaElement.style.display = "none";
    } else if (type.startsWith("video")) {
      document.getElementById("video")?.remove();
      mediaElement = document.createElement("video");
      mediaElement.id = "video";
      mediaElement.controls = false;
      mediaElement.autoplay = true;
      mediaElement.style.position = "fixed";
      mediaElement.style.top = "50%";
      mediaElement.style.left = "50%";
      mediaElement.style.transform = "translate(-50%, -50%)";
      mediaElement.style.zIndex = "9999";
      if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
        mediaElement.style.height = "50vh";
      else mediaElement.style.height = "66vh";
      mediaElement.style.width = "auto";
      mediaElement.style.background = "black";
    } else if (type.startsWith("image")) {
      document.getElementById("image")?.remove();
      mediaElement = document.createElement("img");
      mediaElement.id = "image";
      mediaElement.src = url;
      mediaElement.style.position = "fixed";
      mediaElement.style.top = "50%";
      mediaElement.style.left = "50%";
      mediaElement.style.transform = "translate(-50%, -50%)";
      mediaElement.style.zIndex = "9999";
      mediaElement.style.maxWidth = "90vw";
      mediaElement.style.maxHeight = "90vh";
    }

    if (mediaElement) {
      const source = document.createElement("source");
      source.src = url;
      source.type = type;
      mediaElement.appendChild(source);
      document.body.appendChild(mediaElement);
      if (mediaElement.id == "image") this.playNextMedia();
      mediaElement.onended = () => {
        WS.events.emit("played");
        //document.body.removeChild(mediaElement);
        URL.revokeObjectURL(url);
        this.playNextMedia();
      };

      mediaElement.onerror = () => {
        WS.events.emit("played");
        console.error("Media failed to load:", mediaElement.error);
        alert("Failed to play media. Downloading instead...");
        window.location.href = url;
        //document.body.removeChild(mediaElement);
        URL.revokeObjectURL(url);
        this.playNextMedia();
      };

      mediaElement.onclick = () => {
        WS.events.emit("played");
        mediaElement.remove();
        URL.revokeObjectURL(url);
        this.playNextMedia();
      };
    }
  }
}
const pageKite = true;
const subdomain = "person";
if (pageKite) {
  WS = new WebSocketHandler(`wss://ws-${subdomain}.pagekite.me`);
  WS1 = new WebSocketHandler(`wss://ws-${subdomain}.pagekite.me/recognition`);
} else {
  WS = new WebSocketHandler(`wss://ws${subdomain}.loca.lt`);
  WS1 = new WebSocketHandler(`wss://ws${subdomain}.loca.lt/recognition`);
}

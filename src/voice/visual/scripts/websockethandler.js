class WebSocketHandler {
  constructor(url, reconnect = true) {
    this.url = url;
    this.reconnect = reconnect;
    this.callbacks = [];
    this.ws = null;
    this.reconnectInterval = 1000;
    this.reconnectTimeout = null;
    this.mediaQueue = [];
    this.isPlaying = false;
    this.isReceivingMedia = false;
    this.preloadedMedia = null;
    this.addCallback = this.addCallback;
    this.send = this.send;
    this.events = new EventEmitter();
    this.playNextMedia = this.playNextMedia;
    this.initWebSocket();
  }

  clearReconnectTimeout() {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  scheduleReconnect() {
    this.clearReconnectTimeout();
    if (this.reconnect) {
      console.log("Scheduling reconnect in", this.reconnectInterval, "ms");
      this.reconnectTimeout = setTimeout(() => this.initWebSocket(), this.reconnectInterval);
    }
  }

  initWebSocket() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.events.emit("connected");
      console.log("WebSocket connected");
    };
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.scheduleReconnect();
    };
    this.ws.onclose = () => {
      this.events.emit("disconnected");
      console.log("WebSocket closed.");
      this.scheduleReconnect();
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
        this.isReceivingMedia = loading == "true";
        this.events.emit(loading == "true" ? "loading" : "unloading");
        if (!this.isReceivingMedia && !this.isPlaying && this.mediaQueue.length > 0) {
          this.playNextMedia();
        }
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
      // Always enqueue to media queue to never lose audio
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
    this.updateMediaQueueDisplay();
    if (!this.isPlaying) {
      const needsStartupBuffer =
        this.isReceivingMedia &&
        (type.startsWith("audio") || type.startsWith("video")) &&
        this.mediaQueue.length < 2;
      if (!needsStartupBuffer) this.playNextMedia();
    } else {
      this.prepareNextMedia();
    }
  }

  prepareNextMedia() {
    const item = this.mediaQueue[0];
    if (!item || item.preloaded || item.type.startsWith("image")) return;

    const url = URL.createObjectURL(new Blob([item.buffer], { type: item.type }));
    const element = document.createElement(
      item.type.startsWith("audio") ? "audio" : "video"
    );
    element.preload = "auto";
    element.src = url;
    element.load();
    item.preloaded = { element, url };
    this.preloadedMedia = item.preloaded;
  }

  clearMediaQueue() {
    for (const item of this.mediaQueue) {
      if (item.preloaded) {
        item.preloaded.element.remove();
        URL.revokeObjectURL(item.preloaded.url);
      }
    }
    this.mediaQueue = [];
    this.preloadedMedia = null;
    this.updateMediaQueueDisplay();
  }

  updateMediaQueueDisplay() {
    let queueDiv = document.getElementById("media-queue-display");
    if (!queueDiv) {
      queueDiv = document.createElement("div");
      queueDiv.id = "media-queue-display";
      queueDiv.style.position = "fixed";
      queueDiv.style.top = "0";
      queueDiv.style.left = "0";
      queueDiv.style.width = "100vw";
      queueDiv.style.display = "flex";
      queueDiv.style.justifyContent = "center";
      queueDiv.style.alignItems = "center";
      queueDiv.style.zIndex = "10000";
      queueDiv.style.pointerEvents = "none";
      queueDiv.style.fontSize = "2rem";
      queueDiv.style.padding = "2rem 0";
      document.body.prepend(queueDiv);
    }
    if (this.mediaQueue.length > 0) {
      queueDiv.innerHTML = `
        <span style="position:relative;display:inline-block;font-size:1.5em;">
          ▶
          <span style="
            position:absolute;
            top:-0.1em;
            right:-0.1em;
            background:linear-gradient(145deg,rgb(255, 255, 255),rgb(255, 255, 255));
            color:black;
            border-radius:1em;
            padding:0.2em 0.2em;
            font-size:0.8rem;
            font-family:Silkscreen;
            min-width:1.2em;
            height:1.2em;
            line-height:1.2em;
            text-align:center;
            box-shadow:0 2px 4px rgba(255, 255, 255, 0.2), inset 0 1px 3px rgba(255,255,255,0.3);
            transform:scale(1);
            transition:transform 0.2s ease;
            pointer-events:none;
            font-weight:bold;
          ">${this.mediaQueue.length}</span>
        </span>
      `;
    } else {
      queueDiv.innerHTML = "";
    }
    queueDiv.style.color = "white";
    queueDiv.style.textShadow = "0 0 8px black";
  }

  playNextMedia() {
    if (this.mediaQueue.length === 0) {
      this.isPlaying = false;
      this.updateMediaQueueDisplay();
      return;
    }

    const nextItem = this.mediaQueue[0];
    if (
      this.isReceivingMedia &&
      this.mediaQueue.length < 2 &&
      (nextItem.type.startsWith("audio") || nextItem.type.startsWith("video"))
    ) {
      this.isPlaying = false;
      this.updateMediaQueueDisplay();
      return;
    }

    this.isPlaying = true;
    WS.events.emit("playing");
    const item = this.mediaQueue.shift();
    const { buffer, type } = item;
    const url =
      item.preloaded?.url ?? URL.createObjectURL(new Blob([buffer], { type }));
    this.preloadedMedia = null;

    this.updateMediaQueueDisplay(); // Always update at the start

    if (this.callbacks.length > 0)
      for (let cb of this.callbacks) {
        cb(type.startsWith("audio") ? buffer.slice(0) : buffer, true, type);
      }

    let mediaElement;
    if (type.startsWith("audio")) {
      document.getElementById("audio")?.remove();
      mediaElement = item.preloaded?.element ?? document.createElement("audio");
      mediaElement.id = "audio";
      mediaElement.controls = true;
      mediaElement.autoplay = true;
      mediaElement.style.display = "none";
    } else if (type.startsWith("video")) {
      document.getElementById("video")?.remove();
      mediaElement = item.preloaded?.element ?? document.createElement("video");
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
      if (!item.preloaded) {
        const source = document.createElement("source");
        source.src = url;
        source.type = type;
        mediaElement.appendChild(source);
      }
      document.body.appendChild(mediaElement);
      this.prepareNextMedia();
      if (mediaElement.id == "image") this.playNextMedia();

      let mediaAdvanced = false;
      let timeBeforeEnd = 0.25;
      const advanceMedia = () => {
        if (mediaAdvanced) return;
        mediaAdvanced = true;
        WS.events.emit("played");
        URL.revokeObjectURL(url);
        this.playNextMedia();
        setTimeout(() => this.updateMediaQueueDisplay(), 0);
      };
      mediaElement.onended = advanceMedia;
      mediaElement.ontimeupdate = () => {
        if (!type.startsWith("video")) return;
        if (
          mediaElement.duration &&
          mediaElement.currentTime >= mediaElement.duration - timeBeforeEnd
        ) {
          advanceMedia();
        }
      };
      mediaElement.onerror = () => {
        console.error("Media failed to load:", mediaElement.error);
        alert("Failed to play media. Downloading instead...");
        window.location.href = url;
        advanceMedia();
      };
      mediaElement.onclick = () => {
        mediaElement.remove();
        advanceMedia();
      };

      if (typeof mediaElement.play === "function") {
        const playPromise = mediaElement.play();
        if (playPromise?.catch) {
          playPromise.catch((error) => {
            console.error("Media playback could not start:", error);
          });
        }
      }
    }
  }
}

const subdomain = "blade.tail44dff3.ts.net";
const hostname = window.location.hostname;
const isLocalAssistant = ["localhost", "127.0.0.1"].includes(hostname);
const isTailscaleHost = hostname.endsWith(".ts.net");
const isLocalTunnelHost = hostname.endsWith(".loca.lt");
const isPageKiteHost = hostname.endsWith(".pagekite.me");
const domain = isLocalTunnelHost
  ? ".loca.lt"
  : isPageKiteHost
    ? ".pagekite.me"
    : ".loca.lt";
const activeSubdomain = isLocalTunnelHost || isPageKiteHost
  ? hostname.slice(0, -domain.length)
  : subdomain;
const assistantWsUrl = isLocalAssistant
  ? "ws://localhost:80"
  : isTailscaleHost
    ? `wss://${hostname}:8443`
    : `wss://ws-${activeSubdomain}${domain}`;

window.assistantEndpoints = {
  whisperUrl: isLocalAssistant
    ? "ws://localhost:10000/asr"
    : isTailscaleHost
      ? `wss://${hostname}:10000/asr`
      : `wss://whisper-${activeSubdomain}${domain}/asr`,
};

WS = new WebSocketHandler(assistantWsUrl);
WS1 = new WebSocketHandler(`${assistantWsUrl}/recognition`);

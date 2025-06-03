import WebSocket, { WebSocketServer } from "ws";
import { getProcessing, logic } from "../../index.js";
import {
  getLang,
  getVideo,
  setLang,
  setSpeakerId,
  setVideo,
  speak,
} from "../voice/speak.js";
import {
  ollamaVision,
  setGoogle,
  setKeepInMemory,
  setLLM,
} from "../llm/ollama.js";
import { setHotword } from "../voice/hotword.js";
import { isIPAllowed } from "./IP.js";
import { getFaceMatcher } from "../image/recognition.js";
import { analyzeAndRecognize } from "../image/tensorflow.js";
import { detect_objects_on_image } from "../image/onnx.js";

export let wss = null;

let currentRequestWs = null;

export const getCurrentRequestWs = () => currentRequestWs;

export const setCurrentRequestWs = (ws) => (currentRequestWs = ws);

export const startWs = () => {
  wss = new WebSocketServer({
    port: 80,
    timeout: 1000,
    perMessageDeflate: false,
  });
  wss.on("connection", function connection(ws, req) {
    // console.log(ws, req);
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    console.log("ws connected: ", ip, isIPAllowed(ip), req.url);

    if (!isIPAllowed(ip)) return ws.close();

    ws.on("error", console.error);

    ws.on("message", async function message(data, isBinary) {
      try {
        // console.log(data.toString());
        console.log("ws received isBinary: ", isBinary, "isWav: ", isWav(data), "isMp4: ", isMp4(data), "isImage: ", isImage(data));
        console.log(typeof data);
        console.log("url:", req.url);
        if (!isBinary) {
          const json = JSON.parse(data);
          console.log(JSON.stringify(json, null, 2));
          if (json.speaker != null) setSpeakerId(parseInt(json.speaker, 10));
          if (json.hotword != null) setHotword(json.hotword);
          if (json.video != null) setVideo(json.video);
          if (json.lang != null) setLang(json.lang);
          if (json.google != null) setGoogle(json.google);
          if (json.llm != null) setLLM(json.llm);
          if (json.keepInMemory != null) setKeepInMemory(json.keepInMemory);
          if (json.text != null && json.text != "") {
            await logic(json.text, null, ws);
          }
        }
        if (isBinary) {
          if (req.url == "/recognition") {
            const faceBuffer = await analyzeAndRecognize(
              data,
              getFaceMatcher()
            );
            const objectsBuffer = await detect_objects_on_image(faceBuffer);
            sendToAll(objectsBuffer, true);
          } else
          if(isWav(data) && !getVideo() && getProcessing()) {
            sendToAll(data, true);
          }
          else if(isImage(data) &&  getProcessing())
            await logic(
              getLang() == "fr"
                ? "Ton seul et unique but est de decrire ce que tu vois dans cette image rapidement et concentre toi sur ça et rien d'autre"
                : "Your sole and only goal is to describe what you see in this image shortly and focus on that and nothing else",
              data,
              ws
            );
        }
      } catch (error) {
        console.log("ws error", error);
      }
    });
  });
};

export const sendToAll = (data, binary = false, force = false) => {
  if (getCurrentRequestWs() != null && !force) {
    getCurrentRequestWs().send(data, { binary });
    return;
  }
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary });
    }
  });
};

const isWav = (byteArray) => {
    return (
      byteArray[0] === 0x52 &&
      byteArray[1] === 0x49 &&
      byteArray[2] === 0x46 &&
      byteArray[3] === 0x46
    );
  }

  const isMp4 = (byteArray) => {
    return (
      byteArray[4] === 0x66 &&
      byteArray[5] === 0x74 &&
      byteArray[6] === 0x79 &&
      byteArray[7] === 0x70
    );
  }

  const isImage = (byteArray) => {
    return getImageMimeType(byteArray) !== null;
  }

  const getImageMimeType = (byteArray) => {
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

startWs();

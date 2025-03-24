import WebSocket, { WebSocketServer } from "ws";
import { getProcessing, logic, setProcessing } from "../../index.js";
import {
  getLang,
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
import LanguageDetect from "languagedetect";
import { mapLanguageToCode } from "./mapping.js";

const languageDetector = new LanguageDetect();

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
      console.log("ws received: ", data.toString(), "isBinary: ", isBinary);
      console.log(typeof data);
      console.log("url:", req.url);
      try {
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
            const detected = languageDetector.detect(json.text, 10);
            console.log(detected);
            const language = detected?.shift()?.shift();
            console.log(language, mapLanguageToCode(language, getLang()));
            setLang(mapLanguageToCode(language, getLang()));
            await logic(json.text, null, ws);
          }
        }
        if (isBinary) {
          if (req.url == "/recognition") {
            let faceBuffer = await analyzeAndRecognize(data, getFaceMatcher());
            let objectsBuffer = await detect_objects_on_image(faceBuffer);
            sendToAll(objectsBuffer, true);
          } else
            await logic(
              getLang() == "fr"
                ? "Decris ce que tu vois dans cette image rapidement et réponds en Français"
                : "Describe what you see in this image shortly and answer in English",
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

startWs();

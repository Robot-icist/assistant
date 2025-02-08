import WebSocket, { WebSocketServer } from "ws";
import { logic, setProcessing } from "../../index.js";
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

export let wss = null;

export const startWs = () => {
  wss = new WebSocketServer({
    port: 80,
    timeout: 1000,
    perMessageDeflate: false,
  });
  wss.on("connection", function connection(ws, req) {
    // console.log(ws, req);
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    console.log("ws connected: ", ip);

    if (
      !ip.includes("92.184") && //Android
      !ip.includes("109.210.78.69") && //home
      !ip.includes("128.79.182.244") && //axel home
      !ip.includes("184.163.47.39") && //mike home
      !ip.includes("::1") &&
      ip != ""
    )
      return ws.close();

    ws.on("error", console.error);

    ws.on("message", async function message(data, isBinary) {
      console.log("ws received: ", data.toString(), "isBinary: ", isBinary);
      console.log(typeof data);
      try {
        if (!isBinary) {
          const json = JSON.parse(data);
          console.log(JSON.stringify(json, null, 2));
          if (json.speaker != null) setSpeakerId(parseInt(json.speaker, 10));
          if (json.video != null) setVideo(json.video);
          if (json.lang != null) setLang(json.lang);
          if (json.google != null) setGoogle(json.google);
          if (json.llm != null) setLLM(json.llm);
          if (json.keepInMemory != null) setKeepInMemory(json.keepInMemory);
          if (json.text != null) {
            sendToAll("loading:true");
            await logic(json.text);
            sendToAll("loading:false");
          }
        }
      } catch (error) {
        console.log("ws error", error);
      }
      if (isBinary) {
        sendToAll("loading:true");
        setProcessing(true);
        await ollamaVision(
          getLang() == "fr"
            ? "Decris cette image et réponds en Français"
            : "Describe this image and answer in English",
          speak,
          data
        );
        setProcessing(false);
        sendToAll("loading:false");
      }
    });
  });
};

export const sendToAll = (data, binary = false) => {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary });
    }
  });
};

startWs();

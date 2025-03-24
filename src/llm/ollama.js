import { promises } from "fs";
import { keyboard, mouse, screen, FileType, Key } from "@nut-tree-fork/nut-js";
import { join } from "path";
import {
  mapGlobalKeyToNutKey,
  mapXToScreen,
  mapYToScreen,
} from "../utils/mapping.js";
import { Ollama } from "ollama";
import { LOG } from "../utils/log.js";
import { rl } from "../utils/rl.js";
import camera, { takePictureJpeg } from "../image/camera.js";
import { getHotword } from "../voice/hotword.js";
import { getEvil } from "../../index.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendToAll } from "../utils/ws.js";
import { getLang } from "../voice/speak.js";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

const ollamaInstance = new Ollama();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const geminiModel = "gemini-2.0-flash-lite"; //"gemini-1.5-flash";

let google = process.env.GOOGLE;

export const getGoogle = () => google;

export const setGoogle = (val) => (google = val);

let keepInMemory = false;

export const setKeepInMemory = (val) => (keepInMemory = val);

let resolutionHeight = 0;
let resolutionWidth = 0;
let screenHeight = 0;
let screenWidth = 0;

(async () => {
  const grab = await screen.grab();
  resolutionHeight = grab.height;
  resolutionWidth = grab.width;
  screenHeight = await screen.height();
  screenWidth = await screen.width();
})();

const systemInstructions = () =>
  getLang() == "fr"
    ? `Tu t'appels ${getHotword()}. 
          Tu es un assistant virtuel sur ordinateur, 
          tu fais des phrases assez courtes et tu réponds a toutes mes demandes` // et termine chacunes de tes réponses par le mot "Patron !".`
    : `Your Name is ${getHotword()}. 
          You are a virtual assistant on a computer, 
          you make rather small sentences and you reply to all my demands in the language I write to you.`; // and terminate every of your answers with the word "Boss !".`;

// Initialize conversation history as an array of message objects
let conversationHistory = [
  {
    role: "system",
    content: systemInstructions(),
  },
];

let conversationHistoryGemini = [];

let stream;
let abortController = new AbortController();

export const stopStream = () => {
  stream?.abortController?.abort();
  abortController?.abort();
};

let llm = "llama3.2:1b";

export const setLLM = (val) => (llm = val);
/**
 * Generates and speaks a response using Ollama's LLM.
 *
 * @param {string} text - The input prompt to the LLM.
 * @param {function} speak - The function to speak the generated response.
 * @param {function} cb - The callback.
 */
export async function ollamaChat(text, speak, model = llm) {
  try {
    if (text == "") return;
    console.log("Generating response for:", text, model);

    // Add user input to conversation history
    if (!google) {
      if (conversationHistory.length > 5)
        conversationHistory = conversationHistory.slice(0, 1);
      if (conversationHistory[0].content !== systemInstructions()) {
        console.log("prompt changed");
        conversationHistory = conversationHistory.slice(0, 1);
        conversationHistory[0] = {
          role: "system",
          content: systemInstructions(),
        };
      }
      conversationHistory.push({ role: "user", content: text });
    } else {
      if (conversationHistoryGemini.length > 10)
        conversationHistoryGemini = conversationHistoryGemini.slice(0, 1);
      conversationHistoryGemini.push({ role: "user", parts: [{ text }] });
    }

    console.log(
      !google
        ? conversationHistory
        : JSON.stringify(conversationHistoryGemini, null, 2)
    );

    let accumulatedText = "";
    // let stream = null;
    // const stream = await ollamaInstance.generate({
    if (!google)
      stream = await ollamaInstance.chat({
        model: model,
        // prompt: conversationHistory[0].content
        messages: conversationHistory,
        stream: true,
        //keep_alive: -1, // keep loaded
        // keep_alive: 0, // unload after
        keep_alive: keepInMemory ? -1 : 0,
        options: {
          temperature: getEvil() ? 0.8 : 0,
        },
      });
    else {
      const gemini = genAI.getGenerativeModel({
        model: geminiModel,
        systemInstruction: systemInstructions(),
      });
      const chat = gemini.startChat({
        history: conversationHistoryGemini,
      });
      const result = await chat.sendMessageStream(text, {
        signal: abortController.signal,
      });
      stream = result.stream;
    }
    console.log(Object.keys(stream));

    for await (const chunk of stream) {
      // // for generate
      // process.stdout.write(chunk.response);
      // accumulatedText += chunk.response;
      // for chat
      if (!google) {
        process.stdout.write(chunk.message.content);
        accumulatedText += chunk.message.content;
        sendToAll("text:" + chunk.message.content);
      } else {
        process.stdout.write(chunk.text());
        accumulatedText += chunk.text();
        sendToAll("text:" + chunk.text());
      }
      if (endsWithPunctuation(accumulatedText)) {
        if (speak) {
          let sentences = splitByPunctuation(accumulatedText);
          while (sentences.length > 0) {
            let sentence = sentences.shift().trim().replace(".", "");
            if (sentence != "" && sentence.length > 1)
              await speak(makeSingleLine(sentence));
          }
        }
        console.log("continuing...");
        if (!google) {
          conversationHistory.push({
            role: "assistant",
            content: accumulatedText,
          });
        } else {
          conversationHistoryGemini.push({
            role: "model",
            parts: [{ text: accumulatedText }],
          });
        }
        accumulatedText = "";
      }
    }
    if (accumulatedText.length > 0) {
      if (speak) {
        let sentences = splitByPunctuation(accumulatedText);
        while (sentences.length > 0) {
          let sentence = sentences.shift().trim().replace(".", "");
          if (sentence != "" && sentence.length > 1)
            await speak(makeSingleLine(sentence));
        }
      }
      if (!google) {
        conversationHistory.push({
          role: "assistant",
          content: accumulatedText,
        });
      } else {
        conversationHistoryGemini.push({
          role: "model",
          parts: [{ text: accumulatedText }],
        });
      }
      accumulatedText = "";
    }
  } catch (error) {
    console.error("Error with Ollama API:", error);
  }
}

/**
 * Captures a screenshot using nut.js's `capture` method, sends it to the `llava` model,
 * and executes the returned actions with natural timing using `nut.js`.
 *
 * @param {string} basePrompt - The base text prompt for the model.
 * @returns {Promise<void>}
 */
export async function ollamaVision(basePrompt, speak, bytes) {
  try {
    if (basePrompt == "") return;
    let screenshotPath, webcamPath;
    if (bytes == null) {
      LOG("Capturing the screen...");
      const fileName = "screenshot";
      const fileFormat = FileType.JPG;
      const filePath = join(__dirname, "screenshots"); // Directory for screenshot
      // Ensure output directory exists
      await promises.mkdir(filePath, { recursive: true });
      // await camera.videoCapture.pause();
      await camera.initialize();
      // Capture the screenshot
      screenshotPath = await screen.capture(fileName, fileFormat, filePath);
      LOG(`Screenshot captured and saved to: ${screenshotPath}`);
      webcamPath = filePath + "/webcam.jpg";
      await takePictureJpeg(webcamPath);
      await camera.stop();
      // await camera.videoCapture.start();
      // await camera.videoCapture.resume();
      console.log("\nSending request to llm vision model...");
      // await camera.videoCapture.pause();
    }

    //let stream;
    if (!google)
      stream = await ollamaInstance.generate({
        model: "benzie/llava-phi-3",
        // model: "llama3.2-vision",
        // model: "llava",
        prompt: systemInstructions() + " " + basePrompt,
        // prompt: prompt,
        images:
          bytes != null
            ? [Buffer.from(bytes).toString("base64")]
            : [screenshotPath, webcamPath], // Attach the screenshot
        stream: true,
        // keep_alive: -1, // keep
        // keep_alive: 0, // not keep
        keep_alive: keepInMemory ? -1 : 0,
      });
    else {
      const gemini = genAI.getGenerativeModel({
        model: geminiModel,
        systemInstruction: systemInstructions(),
      });
      // const chat = gemini.startChat({
      //   history: conversationHistoryGemini,
      // });
      // const result = await chat.sendMessageStream(text);
      // stream = result.stream;
      if (bytes) {
        console.log(bytes, bytes.length, bytes.toString("base64"));
        const image = {
          inlineData: {
            data: Buffer.from(bytes).toString("base64"),
            mimeType: "image/jpg",
          },
        };
        console.log(image);
        stream = (
          await gemini.generateContentStream([basePrompt, image], {
            signal: abortController.signal,
          })
        ).stream;
      }
    }
    if (stream == null) return;
    let accumulatedText = "";
    for await (const chunk of stream) {
      if (!google) {
        // process.stdout.write(chunk.message.content);
        // accumulatedText += chunk.message.content;
        process.stdout.write(chunk.response);
        accumulatedText += chunk.response;
        sendToAll("text:" + chunk.response);
      } else {
        process.stdout.write(chunk.text());
        accumulatedText += chunk.text();
        sendToAll("text:" + chunk.text());
      }

      if (endsWithPunctuation(accumulatedText)) {
        let sentences = splitByPunctuation(accumulatedText);
        while (sentences.length > 0) {
          let sentence = sentences.shift().trim().replace(".", "");
          if (sentence != "" && sentence.length > 1)
            await speak(makeSingleLine(sentence));
        }
        if (!google) {
          conversationHistory.push({
            role: "assistant",
            content: accumulatedText,
          });
        } else {
          conversationHistoryGemini.push({
            role: "model",
            parts: [{ text: accumulatedText }],
          });
        }
        accumulatedText = "";
      }
    }

    if (accumulatedText.length > 0) {
      let sentences = splitByPunctuation(accumulatedText);
      while (sentences.length > 0) {
        let sentence = sentences.shift().trim().replace(".", "");
        if (sentence != "" && sentence.length > 1)
          await speak(makeSingleLine(sentence));
      }
      if (!google) {
        conversationHistory.push({
          role: "assistant",
          content: accumulatedText,
        });
      } else {
        conversationHistoryGemini.push({
          role: "model",
          parts: [{ text: accumulatedText }],
        });
      }
      accumulatedText = "";
    }
    // await camera.videoCapture.resume();
    return;
  } catch (error) {
    console.error("Error with Ollama Vision API:", error);
  }
}

export default { ollamaVision, ollamaChat };

function makeSingleLine(inputString) {
  return inputString.replace(/[\t\r\n]/g, " ");
}

function endsWithPunctuation(text) {
  /** Check if a string ends with '.', '?' or '!' */
  return /[.?!]$/.test(text);
}

function splitByPunctuation(text) {
  /** Split the text at '.', '?' or '!' while keeping the delimiters. */
  let sentences = text.split(/([.?!])/);
  let result = [];
  for (let i = 0; i < sentences.length - 1; i += 2) {
    result.push(sentences[i] + sentences[i + 1]);
  }
  return result.length > 0 ? result : sentences;
}

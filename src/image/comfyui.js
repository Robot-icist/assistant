import { Client } from "@stable-canvas/comfyui-client";
import WebSocket from "ws";
import fetch from "node-fetch";
import axios from "axios";
import { sendToAll } from "../global/ws.js";

const payload = {prompt:
 {
  "3": {
    "inputs": {
      "seed": 812426485243358,
      "steps": 50,
      "cfg": 7,
      "sampler_name": "dpmpp_2m",
      "scheduler": "karras",
      "denoise": 1,
      "model": [
        "4",
        0
      ],
      "positive": [
        "6",
        0
      ],
      "negative": [
        "7",
        0
      ],
      "latent_image": [
        "5",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "KSampler"
    }
  },
  "4": {
    "inputs": {
      "ckpt_name": "realisticVisionV60B1_v51HyperVAE.safetensors"
    },
    "class_type": "CheckpointLoaderSimple",
    "_meta": {
      "title": "Charger Point de Contrôle"
    }
  },
  "5": {
    "inputs": {
      "width": 512,
      "height": 512,
      "batch_size": 1
    },
    "class_type": "EmptyLatentImage",
    "_meta": {
      "title": "Image Latente Vide"
    }
  },
  "6": {
    "inputs": {
      "text": "upperbody shot, 1girl,solo,chibi,long hairs, happy, laugh, hugging a teddy bear, looking at viewers, dancing stand, cute, soft color, flowers in background, many flowers, among flowers, best quality, highres, delicate details,",
      "clip": [
        "4",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Prompt)"
    }
  },
  "7": {
    "inputs": {
      "text": "(worst quality, low quality:1.4), (bad anatomy), text, error, missing fingers, extra digit, fewer digits, cropped, jpeg artifacts, signature, watermark, username, blurry, deformed face",
      "clip": [
        "4",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Prompt)"
    }
  },
  "8": {
    "inputs": {
      "samples": [
        "3",
        0
      ],
      "vae": [
        "4",
        2
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "8",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Enregistrer Image"
    }
  },
  "10": {
    "inputs": {
      "value": [
        "8",
        0
      ]
    },
    "class_type": "UnloadAllModels",
    "_meta": {
      "title": "UnloadAllModels"
    }
  }
}
}

export const comfyClient = new Client({
    api_host: "127.0.0.1:7999",
    api_base: "",
    sessionName: "",
    WebSocket: WebSocket,
    fetch: fetch,
  });

 export const generateImage = async (text = "masterpiece best quality man") => {
    comfyClient.connect();
    const prompt = JSON.parse(JSON.stringify(payload.prompt)); // Deep copy to avoid modifying the original
    // Set the text prompt for our positive CLIPTextEncode
    prompt["6"]["inputs"]["text"] = text;
    const resp = await comfyClient.enqueue_polling(prompt);
    console.log(resp);
    const url = resp.images[0].data;
    const response = await axios.get(url,  { responseType: 'arraybuffer' })
    const buffer = Buffer.from(response.data, "utf-8");
    console.log(buffer);
    sendToAll(buffer, true); // Send the image buffer to all connected clients
  };

//   generateImage()
//     .then(() => console.log("done"))
//     .catch((e) => console.error(e))
//     .finally(() => comfyClient.close());
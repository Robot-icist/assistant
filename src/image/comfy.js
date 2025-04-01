import axios from "axios";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { Buffer } from "node:buffer"; // Import the Buffer module
import sharp from "sharp";

const serverAddress = "127.0.0.1:8188";
const clientId = uuidv4();

async function queuePrompt(prompt) {
  try {
    const response = await axios.post(`http://${serverAddress}/prompt`, {
      prompt: prompt,
      client_id: clientId,
    });
    return response.data;
  } catch (error) {
    console.error("Error queuing prompt:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

async function getImage(filename, subfolder, folderType) {
  try {
    const response = await axios.get(`http://${serverAddress}/view`, {
      params: { filename, subfolder, type: folderType },
      responseType: "arraybuffer", // Important for binary data
    });
    return response.data;
  } catch (error) {
    console.error("Error getting image:", error);
    throw error; // Re-throw the error
  }
}

async function getHistory(promptId) {
  try {
    const response = await axios.get(
      `http://${serverAddress}/history/${promptId}`
    );
    return response.data;
  } catch (error) {
    console.error("Error getting history:", error);
    throw error; // Re-throw the error
  }
}

async function getImages(ws, prompt) {
  const promptId = (await queuePrompt(prompt)).prompt_id;
  const outputImages = {};

  return new Promise((resolve, reject) => {
    ws.on("message", async (message) => {
      try {
        if (typeof message === "string") {
          // Check if it's a string (JSON)
          const messageData = JSON.parse(message);

          if (messageData.type === "executing") {
            const data = messageData.data;
            if (data.node === null && data.prompt_id === promptId) {
              // Execution is done
              try {
                const history = await getHistory(promptId);
                const historyData = history[promptId];

                for (const nodeId in historyData.outputs) {
                  const nodeOutput = historyData.outputs[nodeId];
                  const imagesOutput = [];

                  if (nodeOutput.images) {
                    for (const image of nodeOutput.images) {
                      try {
                        const imageData = await getImage(
                          image.filename,
                          image.subfolder,
                          image.type
                        );
                        imagesOutput.push(imageData);
                      } catch (getImageError) {
                        console.error(
                          "Error getting individual image:",
                          getImageError
                        );
                        // Handle individual image retrieval errors.  Continue to process other images.
                      }
                    }
                  }
                  outputImages[nodeId] = imagesOutput;
                }
                resolve(outputImages); // Resolve the promise when all images are fetched
              } catch (historyError) {
                console.error("Error processing history:", historyError);
                reject(historyError); // Reject the promise if history processing fails
              }
            }
          }
        } else if (message instanceof Buffer) {
          // Handle binary data directly
          // Example handling of preview data (might need adjustment depending on ComfyUI's format)
          // console.log("Received binary data (preview)");
          // const bytesIO = message.subarray(8); // Assuming first 8 bytes are some kind of header (check ComfyUI's WS protocol)
          // const image = await sharp(bytesIO).png().toBuffer();  // Requires `sharp` library
          // //  The above line converts the received bytes to a png buffer, then saves that buffer to a file
          // // If you are in a browser enviroment  then you can use a function to return a blob
          // // const blob = new Blob([bytesIO], { type: 'image/jpeg' });
          // //  createImageBitmap(blob) for displaying in a canvas element
        }
      } catch (parseError) {
        console.error("Error parsing message:", parseError);
        // Optionally, reject the promise if parsing is critical
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      reject(error); // Reject on websocket error
    });

    ws.on("close", () => {
      // Connection closed before completion.  This could also be handled with a timeout.
      //  console.warn("WebSocket connection closed unexpectedly.");
      //  reject(new Error("WebSocket connection closed prematurely."));
    });

    ws.on("open", () => {
      // Optional: Log when connection is established.
      // console.log("WebSocket connected");
    });
  });
}

const promptText = {
  3: {
    class_type: "KSampler",
    inputs: {
      cfg: 8,
      denoise: 1,
      latent_image: ["5", 0],
      model: ["4", 0],
      negative: ["7", 0],
      positive: ["6", 0],
      sampler_name: "euler",
      scheduler: "normal",
      seed: 8566257,
      steps: 20,
    },
  },
  4: {
    class_type: "CheckpointLoaderSimple",
    inputs: {
      ckpt_name: "v1-5-pruned-emaonly.safetensors",
    },
  },
  5: {
    class_type: "EmptyLatentImage",
    inputs: {
      batch_size: 1,
      height: 512,
      width: 512,
    },
  },
  6: {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["4", 1],
      text: "masterpiece best quality girl",
    },
  },
  7: {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["4", 1],
      text: "bad hands",
    },
  },
  8: {
    class_type: "VAEDecode",
    inputs: {
      samples: ["3", 0],
      vae: ["4", 2],
    },
  },
  9: {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "ComfyUI",
      images: ["8", 0],
    },
  },
};

async function main() {
  try {
    const prompt = JSON.parse(JSON.stringify(promptText)); // Deep copy to avoid modifying the original

    // Set the text prompt for our positive CLIPTextEncode
    prompt["6"]["inputs"]["text"] = "masterpiece best quality man";

    // Set the seed for our KSampler node
    prompt["3"]["inputs"]["seed"] = 5;

    const ws = new WebSocket(`ws://${serverAddress}/ws?clientId=${clientId}`);

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        console.log("WebSocket connected");
        resolve(); // Resolve when the connection is open
      };
      ws.onerror = (error) => {
        console.error("WebSocket connection error:", error);
        reject(error); // Reject if there's a connection error
      };
    });

    const images = await getImages(ws, prompt);

    ws.close(); // Close the connection after use.

    // Display the output images (example, requires a library like 'jimp' or 'sharp' to handle image data)
    for (const nodeId in images) {
      for (const imageData of images[nodeId]) {
        // console.log(`Image data for node ${nodeId}:`, imageData.length, "bytes");
        // To actually *display* the image, you'll need to decode the binary data.
        // For example, using 'jimp':
        // import Jimp from 'jimp'; // Install with: npm install jimp
        // if (imageData) {
        //     Jimp.read(imageData)
        //         .then(image => {
        //             image.write(`output_image_${nodeId}.png`); // or display in browser
        //             console.log(`Saved image for node ${nodeId}`);
        //         })
        //         .catch(err => {
        //             console.error("Error processing image:", err);
        //         });
        // }
      }
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();

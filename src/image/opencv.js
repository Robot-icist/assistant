import cv from "@u4/opencv4nodejs";
import fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { generateColorFromStringCV } from "../utils/mapping.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

// Preloaded YOLO model and class names
let net;
let classNames = [];

/**
 * Initialize YOLO model and load class names.
 */
export async function initializeCV() {
  const cfgPath = path.resolve(__dirname, "./weights/yolov2-tiny.cfg");
  //   const cfgPath = path.resolve(__dirname, "./weights/yolov3.cfg");
  //   const cfgPath = path.resolve(__dirname, "./weights/yolov3-tiny.cfg");
  const weightsPath = path.resolve(__dirname, "./weights/yolov2-tiny.weights");
  //   const weightsPath = path.resolve(__dirname, "./weights/yolov3.weights");
  //   const weightsPath = path.resolve(__dirname, "./weights/yolov3-tiny.weights");
  const cocoNamesPath = path.resolve(__dirname, "./weights/coco.names");

  // Load YOLO model
  net = await cv.readNetFromDarknetAsync(cfgPath, weightsPath);
  net.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
  net.setPreferableTarget(cv.DNN_TARGET_CPU);

  // Load COCO class names
  classNames = (await fs.readFile(cocoNamesPath, "utf-8"))
    .split("\n")
    .filter(Boolean);
}

/**
 * Detect objects in an image buffer.
 * @param {Buffer} imageBuffer - JPEG image buffer.
 * @returns {Promise<Buffer>} - Image buffer with drawn bounding boxes.
 */
export async function detectObjects(imageBuffer) {
  if (!net || classNames.length === 0) {
    throw new Error("YOLO model not initialized. Call initializeYOLO first.");
  }

  // Decode the image from buffer
  const img = await cv.imdecodeAsync(imageBuffer);

  // Prepare the image for YOLO
  const inputBlob = await cv.blobFromImageAsync(
    img,
    1 / 255.0,
    new cv.Size(416, 416),
    new cv.Vec(0, 0, 0),
    true,
    false
  );

  await net.setInputAsync(inputBlob);

  // Get layer names and unconnected output layers
  const layerNames = await net.getLayerNamesAsync();
  const unconnectedOutLayers = await net.getUnconnectedOutLayersAsync();
  const outputLayerNames = unconnectedOutLayers.map(
    (index) => layerNames[index - 1]
  ); // Adjust for 1-based index

  // Forward pass through the network
  const layerOutputs = await Promise.all(
    outputLayerNames.map(async (layerName) => {
      try {
        const outputMat = net.forward(layerName); // Get OpenCV Mat
        return outputMat.getDataAsArray(); // Convert Mat to array
      } catch (error) {
        console.log(error);
      }
    })
  );

  // Image dimensions
  const { rows: height, cols: width } = img;

  const boxes = [];
  const confidences = [];
  const classIds = [];

  // Process each output layer's detections
  for (const output of layerOutputs) {
    for (const detection of output) {
      const scores = detection.slice(5); // Class confidence scores
      const maxScore = Math.max(...scores);
      const classId = scores.indexOf(maxScore);

      if (maxScore > 0.5) {
        // Extract bounding box coordinates
        const centerX = detection[0] * width;
        const centerY = detection[1] * height;
        const boxWidth = detection[2] * width;
        const boxHeight = detection[3] * height;

        const x = Math.round(centerX - boxWidth / 2);
        const y = Math.round(centerY - boxHeight / 2);

        boxes.push(
          new cv.Rect(x, y, Math.round(boxWidth), Math.round(boxHeight))
        );
        confidences.push(maxScore);
        classIds.push(classId);
      }
    }
  }

  // Perform Non-Max Suppression independently for each class
  const drawnBoxes = new Set();
  for (const classId of new Set(classIds)) {
    const indices = cv.NMSBoxes(
      boxes.filter((_, i) => classIds[i] === classId),
      confidences.filter((_, i) => classIds[i] === classId),
      0.5, // Confidence threshold
      0.4 // Non-max suppression threshold
    );

    for (const i of indices) {
      const rect = boxes[i];
      if (!drawnBoxes.has(`${rect.x},${rect.y},${rect.width},${rect.height}`)) {
        drawnBoxes.add(`${rect.x},${rect.y},${rect.width},${rect.height}`);
        const confidence = confidences[i];

        // Draw rectangle
        img.drawRectangle(
          rect,
          generateColorFromStringCV(classNames[classId]),
          2
        );

        // Add label and confidence
        const label = `${classNames[classId]}: ${(confidence * 100).toFixed(
          2
        )}%`;
        img.putText(
          label,
          new cv.Point2(rect.x, rect.y - 10),
          cv.FONT_HERSHEY_SIMPLEX,
          0.5,
          generateColorFromStringCV(classNames[classId]),
          2
        );
      }
    }
  }

  // Encode the modified image back to a buffer
  return cv.imencode(".jpg", img);
}

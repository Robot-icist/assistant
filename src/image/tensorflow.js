// https://github.com/tensorflow/tfjs/issues/4116 // tofix not found module issue
/*
This worked for me:

Solution: move D:\TFJS\node_modules\@tensorflow\tfjs-node\deps\lib\tensorflow.dll 
to D:\TFJS\node_modules\@tensorflow\tfjs-node\lib\napi-v6\
 */
// // import nodejs bindings to native tensorflow,
// // not required, but will speed up things drastically (python required)
// import tfnode from "@tensorflow/tfjs-node";
import tfnode from "@tensorflow/tfjs-node-gpu";

// if (process.env.TTS) tfnode.setBackend("cpu");

// import mobilenet from "@tensorflow-models/mobilenet";
// import coco from "@tensorflow-models/coco-ssd";

// implements nodejs wrappers for HTMLCanvasElement, HTMLImageElement, ImageData
import * as canvas from "canvas";
// import faceapi from "face-api.js"; // old module
import faceapi from "@vladmandic/face-api";

import { speak } from "../voice/speak.js";
import sharp from "sharp";
// import { initializeCV, detectObjects } from "./opencv.js";
// import { initializeOnnx, detect_objects_on_image } from "./onnx.js";

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

// patch nodejs environment, we need to provide an implementation of
// HTMLCanvasElement and HTMLImageElement
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const weightsDir = path.resolve(__dirname, "./weights");

// SsdMobilenetv1Options
const minConfidence = 0.5;

// TinyFaceDetectorOptions
// (XS = 224), (SM = 320), (MD = 416), (LG = 608);
const inputSize = 224;
const scoreThreshold = 0.5;

let currentMatch = "";

// export const faceDetectionNet = faceapi.nets.ssdMobilenetv1;
export const faceDetectionNet = faceapi.nets.tinyFaceDetector;

export function getFaceDetectorOptions(net) {
  return net === faceapi.nets.ssdMobilenetv1
    ? new faceapi.SsdMobilenetv1Options({ minConfidence })
    : new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });
}

export const faceDetectionOptions = getFaceDetectorOptions(faceDetectionNet);

// Load models
export async function loadModels() {
  await faceDetectionNet.loadFromDisk(weightsDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(weightsDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(weightsDir);
  await faceapi.nets.faceExpressionNet.loadFromDisk(weightsDir);
  await faceapi.nets.ageGenderNet.loadFromDisk(weightsDir);
}

export async function createLabeledDescriptors(folderPath) {
  const labels = fs.readdirSync(folderPath); // Folder names as labels
  const labeledDescriptors = [];

  // Process images in parallel for each label
  await Promise.all(
    labels.map(async (label) => {
      if (!label.includes("gilles")) return;
      const imagesPath = path.join(folderPath, label);
      const imageFiles = fs.readdirSync(imagesPath);
      const descriptors = [];

      // Process each image concurrently
      await Promise.all(
        imageFiles.map(async (imageFile) => {
          const imagePath = path.join(imagesPath, imageFile);
          const img = await canvas.loadImage(imagePath);
          const detection = await faceapi
            .detectSingleFace(img, getFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (detection) {
            descriptors.push(detection.descriptor);
          }
        })
      );

      // If descriptors were found, add them to the labeledDescriptors array
      if (descriptors.length) {
        labeledDescriptors.push(
          new faceapi.LabeledFaceDescriptors(label, descriptors)
        );
      }
    })
  );
  return labeledDescriptors;
}

export const createFaceMatcher = async () => {
  // Path to the dataset
  const datasetPath = path.join(__dirname, "./pictures/");

  //Train
  const labeledDescriptors = await createLabeledDescriptors(datasetPath);
  const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors);
  return faceMatcher;
};

// Optimized loadImage function without external libraries
export async function loadImage(imagePathOrBuffer) {
  // Check if the input is a path or a buffer
  let imageBuffer;

  if (Buffer.isBuffer(imagePathOrBuffer)) {
    // If it's already a buffer, use it directly
    imageBuffer = imagePathOrBuffer;
  } else {
    // Otherwise, read the image from the filesystem (if path is provided)
    imageBuffer = await fs.promises.readFile(imagePathOrBuffer);
  }

  // Create a new Image object from the buffer
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img); // On image load, resolve with the img object
    img.onerror = (err) => reject(err); // On error, reject the promise

    // Load the buffer directly into the image
    img.src = imageBuffer;
  });
}

function getClosestExpression(expressions) {
  // Extract entries and find the key with the max value closest to 1
  return Object.keys(expressions).reduce((closestKey, currentKey) => {
    return expressions[currentKey] > expressions[closestKey]
      ? currentKey
      : closestKey;
  });
}

let lastSpokenMatch = ""; // Keeps track of the last spoken match
let lastSpeakTime = 0; // Tracks the timestamp of the last speak operation
const SPEAK_INTERVAL = 5000; // Minimum interval between speaks in milliseconds

// const mb = await mobilenet.load();
// const ssd = await coco.load();

// Analyze and recognize faces in an image
export async function analyzeAndRecognize(imagePathOrBuffer, faceMatcher) {
  // //mobilenet
  // const decodedImage = await tfnode.node.decodeJpeg(imagePathOrBuffer, 3);
  // const predictions = await mb.classify(decodedImage);
  // console.log("mobilenet predictions:", predictions);
  // //cocossd
  // const decodedImage = await tfnode.node.decodeJpeg(imagePathOrBuffer, 3);
  // const predictions = await ssd.detect(decodedImage);
  // console.log("coco predictions:", predictions);

  // const img = await canvas.loadImage(imagePathOrBuffer);
  const img = await loadImage(imagePathOrBuffer);
  const detections = await faceapi
    .detectAllFaces(img, getFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions()
    .withAgeAndGender()
    .withFaceDescriptors();

  const outCanvas = faceapi.createCanvasFromMedia(img);
  faceapi.draw.drawDetections(outCanvas, detections, { boxColor: "black" });
  faceapi.draw.drawFaceLandmarks(outCanvas, detections, {
    lineColor: "black",
    pointColor: "blue",
    drawLines: true,
    drawPoints: true,
    lineWidth: 1,
    pointSize: 2,
  });

  const minProbability = 0.05;
  faceapi.draw.drawFaceExpressions(outCanvas, detections, minProbability);

  const currentTime = Date.now(); // Get the current timestamp

  // Add age, gender, and recognition labels
  detections.forEach(async (result) => {
    const { age, gender, genderProbability } = result;
    const box = result.detection.box;
    // Match the face using the FaceMatcher
    const bestMatch = faceMatcher.findBestMatch(result.descriptor);

    currentMatch = bestMatch._label;

    // const closestExpression = getClosestExpression(result.expressions);

    // Speak only if the match is different and enough time has passed
    if (
      currentMatch !== lastSpokenMatch &&
      currentTime - lastSpeakTime >= SPEAK_INTERVAL
    ) {
      lastSpokenMatch = currentMatch; // Update the last spoken match
      lastSpeakTime = currentTime; // Update the last speak time
      // speak(`Hello ${currentMatch} ! I can see you are ${closestExpression}`); // Speak the name
      await speak(`Hello ${currentMatch} !`); // Speak the name
    }

    const textFields = [
      `Age: ${Math.round(age)}`,
      `Gender: ${gender} (${(genderProbability * 100).toFixed(2)}%)`,
      `Match: ${bestMatch.toString()}`,
    ];

    new faceapi.draw.DrawTextField(textFields, box.bottomRight).draw(outCanvas);
  });

  return outCanvas.toBuffer("image/jpeg");
}

// Helper function to collect a stream into a buffer
export function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// Display the canvas buffer in the browser
export async function displayBufferInBrowser(buffer, page) {
  const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  // Load the image directly in the browser
  await page.setContent(`
    <html>
      <body style="margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: #000;">
        <img src="${dataUrl}" style="max-width: 100%; max-height: 100%;">
      </body>
    </html>
  `);
}

// Helper function to extract face from an image
async function extractFace(imageBuffer, box) {
  const { x, y, width, height } = box;
  return sharp(imageBuffer)
    .extract({
      left: Math.floor(x),
      top: Math.floor(y),
      width: Math.floor(width),
      height: Math.floor(height),
    })
    .toBuffer();
}

// Helper function to extract face from an image using a circular shape
async function extractFaceCircle(imageBuffer, box) {
  const { x, y, width, height } = box;

  // Create a circular mask
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
      <circle cx="${width / 2}" cy="${height / 2}" r="${
      Math.min(width, height) / 2
    }" fill="white" />
    </svg>`
  );

  // Apply the mask to the image to extract the circular region
  return sharp(imageBuffer)
    .extract({
      left: Math.floor(x),
      top: Math.floor(y),
      width: Math.floor(width),
      height: Math.floor(height),
    })
    .composite([{ input: mask, blend: "dest-in" }]) // Use the circular mask
    .toBuffer();
}

// Helper function to resize the extracted face to fit the target dimensions
async function resizeFace(faceBuffer, width, height) {
  return sharp(faceBuffer)
    .resize({ width: Math.floor(width), height: Math.floor(height) })
    .toBuffer();
}

// Helper function to blend the resized face into the target image
async function blendFace(imageBuffer, faceBuffer, targetBox) {
  const { x, y } = targetBox;
  return sharp(imageBuffer)
    .composite([{ input: faceBuffer, top: Math.floor(y), left: Math.floor(x) }])
    .toBuffer();
}

// Function to swap faces between two regions
async function swapFaces(imageBuffer, sourceBox, targetBox) {
  // Extract both faces
  // const sourceFace = await extractFace(imageBuffer, sourceBox);
  const sourceFace = await extractFaceCircle(imageBuffer, sourceBox);
  // const targetFace = await extractFace(imageBuffer, targetBox);
  const targetFace = await extractFaceCircle(imageBuffer, targetBox);

  // Resize each face to fit the other's bounding box
  const resizedSourceFace = await resizeFace(
    sourceFace,
    targetBox.width,
    targetBox.height
  );
  const resizedTargetFace = await resizeFace(
    targetFace,
    sourceBox.width,
    sourceBox.height
  );

  // Blend each resized face into the opposite's location
  let updatedImage = await blendFace(imageBuffer, resizedSourceFace, targetBox);
  updatedImage = await blendFace(updatedImage, resizedTargetFace, sourceBox);

  return updatedImage;
}

// Merged function for face swapping (either one or two faces)
export async function faceSwap(imagePathOrBuffer1, imagePathOrBuffer2) {
  const img1 = await loadImage(imagePathOrBuffer1);
  const img2 = await loadImage(imagePathOrBuffer2);

  // Detect faces with landmarks and descriptors in both images
  const detections1 = await faceapi
    .detectAllFaces(img1, getFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();

  const detections2 = await faceapi
    .detectAllFaces(img2, getFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();

  const outCanvas1 = faceapi.createCanvasFromMedia(img1);
  const outCanvas2 = faceapi.createCanvasFromMedia(img2);

  let imageBuffer1 = outCanvas1.toBuffer("image/jpeg");
  let imageBuffer2 = outCanvas2.toBuffer("image/jpeg");

  if (detections1.length >= 2) {
    // If at least two faces are detected in the first image
    const [source, target] = detections1;
    const sourceBox = source.detection.box;
    const targetBox = target.detection.box;

    // Extract and swap faces for the first image
    const swappedImageBuffer = await swapFaces(
      imageBuffer1,
      sourceBox,
      targetBox
    );

    return swappedImageBuffer;
  } else if (detections2.length > 0 && detections1.length > 0) {
    // If one face in each image, swap the first detected faces
    const targetBox = detections1[0].detection.box;
    const sourceDetection = detections2[0];
    const sourceBox = sourceDetection.detection.box;

    // Extract face from source image and swap with target image
    const sourceImageBuffer = await sharp(imagePathOrBuffer2).toBuffer();
    const sourceFace = await extractFaceCircle(sourceImageBuffer, sourceBox);

    let swappedImageBuffer = await sharp(imagePathOrBuffer1).toBuffer(); // Start with target image buffer

    // Perform swapping for the first detected face in the target image
    const resizedFace = await resizeFace(
      sourceFace,
      targetBox.width,
      targetBox.height
    );
    swappedImageBuffer = await blendFace(
      swappedImageBuffer,
      resizedFace,
      targetBox
    );

    return swappedImageBuffer; // Return the swapped image buffer
  } else {
    throw new Error("At least one face must be detected in each image.");
  }
}

// Helper function to draw a polygon based on landmark points
function drawPolygon(ctx, points, color = "rgba(0, 0, 255, 0.3)") {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Helper function to draw ellipses
function drawEllipse(
  ctx,
  centerX,
  centerY,
  radiusX,
  radiusY,
  color = "rgba(0, 0, 255, 0.3)"
) {
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFaceFeatures(ctx, landmarks, options = {}) {
  const {
    cheeksColor = "rgba(255, 192, 203, 0.5)", // Light pink for cheeks
    mouthColor = "rgba(255, 0, 0, 0.5)", // Red for mouth
    eyesColor = "rgba(0, 255, 0, 0.5)", // Green for eyes
    foreheadColor = "rgba(0, 0, 255, 0.3)", // Blue for forehead
    chinColor = "rgba(255, 255, 0, 0.3)", // Yellow for chin
    earsColor = "rgba(128, 0, 128, 0.5)", // Purple for ears
    hairColor = "rgba(139, 69, 19, 0.5)", // Brown for hair
  } = options;

  // Landmarks
  const jaw = landmarks.getJawOutline();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const mouth = landmarks.getMouth();
  const nose = landmarks.getNose();
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  // Cheeks (approximate areas near the jaw and eyes)
  const leftCheek = [jaw[2], jaw[4], leftEye[0]];
  const rightCheek = [jaw[12], jaw[14], rightEye[3]];
  drawPolygon(ctx, leftCheek, cheeksColor);
  drawPolygon(ctx, rightCheek, cheeksColor);

  // Mouth
  drawPolygon(ctx, mouth, mouthColor);

  // Eyes
  drawPolygon(ctx, leftEye, eyesColor);
  drawPolygon(ctx, rightEye, eyesColor);

  // Chin (jawline region)
  const chinRegion = jaw.slice(6, 11);
  drawPolygon(ctx, chinRegion, chinColor);

  // Forehead (improved positioning using eyebrows and extending upward)
  const foreheadTop = Math.min(leftBrow[2].y, rightBrow[2].y) - 40; // Adjust height as needed
  const forehead = [
    { x: leftBrow[0].x, y: foreheadTop }, // Extend upward above left eyebrow
    { x: rightBrow[rightBrow.length - 1].x, y: foreheadTop }, // Above right eyebrow
    { x: rightBrow[rightBrow.length - 1].x, y: rightBrow[2].y + 10 }, // Right brow base
    { x: leftBrow[0].x, y: leftBrow[2].y + 10 }, // Left brow base
  ];
  drawPolygon(ctx, forehead, foreheadColor);

  // Ears (approximation using jawline ends)
  const earRadiusX = 30; // Adjust size as needed
  const earRadiusY = 50;
  const leftEar = { x: jaw[0].x - 20, y: jaw[0].y };
  const rightEar = { x: jaw[jaw.length - 1].x + 20, y: jaw[jaw.length - 1].y };
  drawEllipse(ctx, leftEar.x, leftEar.y, earRadiusX, earRadiusY, earsColor);
  drawEllipse(ctx, rightEar.x, rightEar.y, earRadiusX, earRadiusY, earsColor);

  // Hair (better estimation using jawline and forehead extension)
  const hairTop = foreheadTop - 50; // Extend above the forehead for the hairline
  const hair = [
    { x: jaw[0].x, y: jaw[0].y - 20 }, // Left jaw near temple
    { x: jaw[jaw.length - 1].x, y: jaw[jaw.length - 1].y - 20 }, // Right jaw near temple
    { x: rightBrow[rightBrow.length - 1].x, y: hairTop }, // Hairline right side
    { x: leftBrow[0].x, y: hairTop }, // Hairline left side
  ];
  drawPolygon(ctx, hair, hairColor);
}

function drawFaceFeaturesLinesAndDots(ctx, landmarks, options = {}) {
  const {
    cheeksColor = "rgba(255, 192, 203, 0.5)", // Light pink for cheeks
    mouthColor = "rgba(255, 0, 0, 0.5)", // Red for mouth
    eyesColor = "rgba(0, 255, 0, 0.5)", // Green for eyes
    foreheadColor = "rgba(0, 0, 255, 0.3)", // Blue for forehead
    chinColor = "rgba(255, 255, 0, 0.3)", // Yellow for chin
    earsColor = "rgba(128, 0, 128, 0.5)", // Purple for ears
    hairColor = "rgba(139, 69, 19, 0.5)", // Brown for hair
    lineColor = "rgba(0, 0, 0, 0.8)", // Black for connecting lines
    pointColor = "rgba(255, 255, 255, 1)", // White for key points
    pointRadius = 3, // Radius for key points
  } = options;

  // Landmarks
  const jaw = landmarks.getJawOutline();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const mouth = landmarks.getMouth();
  const nose = landmarks.getNose();
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  // Helper to draw lines
  const drawLine = (from, to, color) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  // Helper to draw points
  const drawPoint = (point, color) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Draw each feature
  const drawPolygonWithConnections = (points, color) => {
    drawPolygon(ctx, points, color);
    for (let i = 0; i < points.length - 1; i++) {
      drawLine(points[i], points[i + 1], lineColor); // Connect sequential points
    }
    drawLine(points[points.length - 1], points[0], lineColor); // Close the loop
  };

  // Cheeks
  const leftCheek = [jaw[2], jaw[4], leftEye[0]];
  const rightCheek = [jaw[12], jaw[14], rightEye[3]];
  drawPolygonWithConnections(leftCheek, cheeksColor);
  drawPolygonWithConnections(rightCheek, cheeksColor);

  // Mouth
  drawPolygonWithConnections(mouth, mouthColor);

  // Eyes
  drawPolygonWithConnections(leftEye, eyesColor);
  drawPolygonWithConnections(rightEye, eyesColor);

  // Chin
  const chinRegion = jaw.slice(6, 11);
  drawPolygonWithConnections(chinRegion, chinColor);

  // Forehead
  const foreheadTop = Math.min(leftBrow[2].y, rightBrow[2].y) - 40;
  const forehead = [
    { x: leftBrow[0].x, y: foreheadTop },
    { x: rightBrow[rightBrow.length - 1].x, y: foreheadTop },
    { x: rightBrow[rightBrow.length - 1].x, y: rightBrow[2].y + 10 },
    { x: leftBrow[0].x, y: leftBrow[2].y + 10 },
  ];
  drawPolygonWithConnections(forehead, foreheadColor);

  // Hair
  const hairTop = foreheadTop - 60;
  const hair = [
    { x: jaw[0].x, y: jaw[0].y - 20 },
    { x: jaw[jaw.length - 1].x, y: jaw[jaw.length - 1].y - 20 },
    { x: rightBrow[rightBrow.length - 1].x, y: hairTop },
    { x: leftBrow[0].x, y: hairTop },
  ];
  drawPolygonWithConnections(hair, hairColor);

  // Ears
  const earRadiusX = 30;
  const earRadiusY = 50;
  const leftEar = { x: jaw[0].x - 20, y: jaw[0].y };
  const rightEar = { x: jaw[jaw.length - 1].x + 20, y: jaw[jaw.length - 1].y };
  drawEllipse(ctx, leftEar.x, leftEar.y, earRadiusX, earRadiusY, earsColor);
  drawEllipse(ctx, rightEar.x, rightEar.y, earRadiusX, earRadiusY, earsColor);

  // Connections between features
  drawLine(jaw[8], nose[3], lineColor); // Chin to nose
  drawLine(nose[3], leftEye[3], lineColor); // Nose to left eye
  drawLine(nose[3], rightEye[0], lineColor); // Nose to right eye
  drawLine(leftEye[3], leftBrow[0], lineColor); // Left eye to left brow
  drawLine(rightEye[0], rightBrow[rightBrow.length - 1], lineColor); // Right eye to right brow
  drawLine(leftBrow[0], hair[3], lineColor); // Left brow to hair
  drawLine(rightBrow[rightBrow.length - 1], hair[2], lineColor); // Right brow to hair

  // Draw key points
  [
    ...jaw,
    ...leftEye,
    ...rightEye,
    ...nose,
    ...leftBrow,
    ...rightBrow,
    ...mouth,
  ].forEach((point) => drawPoint(point, pointColor));
}

// Function to apply face features to all detected faces
export async function drawFaceMasksWithFeatures(imagePathOrBuffer) {
  const img = await canvas.loadImage(imagePathOrBuffer);

  // Detect faces with landmarks
  const detections = await faceapi
    .detectAllFaces(img, getFaceDetectorOptions())
    .withFaceLandmarks();

  if (detections.length === 0) {
    throw new Error("No faces detected in the image.");
  }

  const outCanvas = faceapi.createCanvasFromMedia(img);
  const ctx = outCanvas.getContext("2d");

  // Draw face features for each detection
  detections.forEach((detection) => {
    const landmarks = detection.landmarks;
    drawFaceFeatures(ctx, landmarks);
    // drawFaceFeaturesLinesAndDots(ctx, landmarks);
  });

  return outCanvas.toBuffer("image/jpeg");
}

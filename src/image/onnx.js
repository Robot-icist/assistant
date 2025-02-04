import * as ort from "onnxruntime-node";
import * as path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage } from "canvas";
import sharp from "sharp";
import { generateColorFromString } from "../utils/mapping.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Get the directory name

let model = null;

export async function initializeOnnx(backend = "dml") {
  if (!model) {
    model = await ort.InferenceSession.create(
      //   path.resolve(__dirname, "./weights/yolov11.onnx")
      path.resolve(__dirname, "./weights/yolov8m.onnx"),
      {
        executionProviders: backend === "dml" ? ["dml"] : ["cpu"],
      }
    );
  }
}

/**
 * Function receives an image, passes it through YOLOv8 neural network
 * and returns an array of detected objects and their bounding boxes
 * @param buf Input image body
 * @returns Array of bounding boxes in format [[x1,y1,x2,y2,object_type,probability],..]
 */
export async function detect_objects_on_image(buf) {
  const [input, img_width, img_height] = await prepare_input(buf);
  const output = await run_model(input);
  //   const boxes = process_outputV11(output, img_width, img_height);
  //   return drawImageAndBoxesV11(buf, boxes);
  const boxes = process_outputV8(output, img_width, img_height);
  return drawImageAndBoxesV8(buf, boxes);
}

/**
 * Function used to convert input image to tensor,
 * required as an input to YOLOv8 object detection
 * network.
 * @param buf Content of uploaded file
 * @returns Array of pixels
 */
export async function prepare_input(buf) {
  const img = sharp(buf);
  const md = await img.metadata();
  const { width: img_width, height: img_height } = md;
  const pixels = await img
    .removeAlpha()
    .resize({ width: 640, height: 640, fit: "fill" })
    .raw()
    .toBuffer();

  // Directly construct the input tensor without separate red, green, blue arrays
  const input = new Float32Array(640 * 640 * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    input[i / 3] = pixels[i] / 255.0; // Red channel
    input[pixels.length / 3 + i / 3] = pixels[i + 1] / 255.0; // Green channel
    input[(2 * pixels.length) / 3 + i / 3] = pixels[i + 2] / 255.0; // Blue channel
  }

  return [input, img_width, img_height];
}

/**
 * Function used to pass provided input tensor to YOLOv8 neural network and return result
 * @param input Input pixels array
 * @returns Raw output of neural network as a flat array of numbers
 */
export async function run_model(input) {
  input = new ort.Tensor(Float32Array.from(input), [1, 3, 640, 640]);
  //   const outputs = await model.run({ image: input }); // V11
  //   return outputs; //V11
  const outputs = await model.run({ images: input }); //V8
  return outputs["output0"].data; //V8
}

/**
 * Function used to convert RAW output from YOLOv8 to an array of detected objects.
 * Each object contains the bounding box, type of object, and the probability.
 * @param output Raw output of YOLOv8 network
 * @param img_width Width of original image
 * @param img_height Height of original image
 * @returns Array of detected objects in a format [[x1, y1, x2, y2, object_type, probability],..]
 */
export function process_outputV8(output, img_width, img_height) {
  let boxes = [];
  let classProbabilities = {}; // Object to map class names to their probabilities

  for (let index = 0; index < 8400; index++) {
    const [class_id, prob] = [...Array(80).keys()]
      .map((col) => [col, output[8400 * (col + 4) + index]]) // Get class probability
      .reduce((accum, item) => (item[1] > accum[1] ? item : accum), [0, 0]);

    if (prob < 0.4) {
      continue; // Skip boxes with low probability
    }

    const className = yolo_classes[class_id];
    const label = `${className} (${(prob * 100).toFixed(2)}%)`;

    // Map the class to its probability
    if (!classProbabilities[className]) {
      classProbabilities[className] = [];
    }
    classProbabilities[className].push(prob);

    const xc = output[index];
    const yc = output[8400 + index];
    const w = output[2 * 8400 + index];
    const h = output[3 * 8400 + index];
    const x1 = ((xc - w / 2) / 640) * img_width;
    const y1 = ((yc - h / 2) / 640) * img_height;
    const x2 = ((xc + w / 2) / 640) * img_width;
    const y2 = ((yc + h / 2) / 640) * img_height;

    boxes.push([x1, y1, x2, y2, label, prob]);
  }

  //   // Log distinct classes with their probabilities
  //   console.log("Class Probabilities: ");
  //   Object.keys(classProbabilities).forEach((className) => {
  //     const probs = classProbabilities[className];
  //     console.log(
  //       `${className}: ${probs
  //         .map((prob) => (prob * 100).toFixed(2) + "%")
  //         .join(", ")}`
  //     );
  //   });

  // Sort boxes by confidence (probability) in descending order
  boxes = boxes.sort((box1, box2) => box2[5] - box1[5]);
  const result = [];

  // Apply Non-Maximum Suppression (NMS) to filter overlapping boxes
  while (boxes.length > 0) {
    result.push(boxes[0]);
    boxes = boxes.filter((box) => iou(boxes[0], box) < 0.7);
  }

  return result;
}

/**
 * Function used to process YOLOv11 output.
 * @param output - raw output
 * @param img_width - Original image width
 * @param img_height - Original image height
 * @param confidence_threshold - Minimum confidence threshold for considering a box
 * @returns Array of bounding boxes in the format [x1, y1, x2, y2, class_idx, score]
 */
export function process_outputV11(
  output,
  img_width,
  img_height,
  confidence_threshold = 0.5
) {
  const boxesData = output.boxes.cpuData;
  const scoresData = output.scores.cpuData;
  const classIdxData = output.class_idx.cpuData;

  const processedBoxes = [];

  // Process each box (in YOLOv11's output there are 8400 boxes)
  for (let i = 0; i < boxesData.length / 4; i++) {
    // Each box has 4 values: x1, y1, x2, y2
    const x1 = boxesData[i * 4];
    const y1 = boxesData[i * 4 + 1];
    const x2 = boxesData[i * 4 + 2];
    const y2 = boxesData[i * 4 + 3];

    // Get the confidence score and class index
    const score = scoresData[i];
    const classIdx = classIdxData[i];

    // If the confidence score is above the threshold, keep the box
    if (score >= confidence_threshold) {
      // Scale the box coordinates to the original image size
      const scaledX1 = Math.max(0, x1 * img_width);
      const scaledY1 = Math.max(0, y1 * img_height);
      const scaledX2 = Math.min(img_width, x2 * img_width);
      const scaledY2 = Math.min(img_height, y2 * img_height);

      processedBoxes.push([
        scaledX1,
        scaledY1,
        scaledX2,
        scaledY2,
        classIdx,
        score,
      ]);
    }
  }

  return processedBoxes;
}
/**
 * Function calculates "Intersection-over-union" coefficient for specified two boxes
 * https://pyimagesearch.com/2016/11/07/intersection-over-union-iou-for-object-detection/.
 * @param box1 First box in format: [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format: [x1,y1,x2,y2,object_class,probability]
 * @returns Intersection over union ratio as a float number
 */
export function iou(box1, box2) {
  return intersection(box1, box2) / union(box1, box2);
}

/**
 * Function calculates union area of two boxes.
 *     :param box1: First box in format [x1,y1,x2,y2,object_class,probability]
 *     :param box2: Second box in format [x1,y1,x2,y2,object_class,probability]
 *     :return: Area of the boxes union as a float number
 * @param box1 First box in format [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format [x1,y1,x2,y2,object_class,probability]
 * @returns Area of the boxes union as a float number
 */
export function union(box1, box2) {
  const [box1_x1, box1_y1, box1_x2, box1_y2] = box1;
  const [box2_x1, box2_y1, box2_x2, box2_y2] = box2;
  const box1_area = (box1_x2 - box1_x1) * (box1_y2 - box1_y1);
  const box2_area = (box2_x2 - box2_x1) * (box2_y2 - box2_y1);
  return box1_area + box2_area - intersection(box1, box2);
}

/**
 * Function calculates intersection area of two boxes
 * @param box1 First box in format [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format [x1,y1,x2,y2,object_class,probability]
 * @returns Area of intersection of the boxes as a float number
 */
export function intersection(box1, box2) {
  const [box1_x1, box1_y1, box1_x2, box1_y2] = box1;
  const [box2_x1, box2_y1, box2_x2, box2_y2] = box2;
  const x1 = Math.max(box1_x1, box2_x1);
  const y1 = Math.max(box1_y1, box2_y1);
  const x2 = Math.min(box1_x2, box2_x2);
  const y2 = Math.min(box1_y2, box2_y2);
  return (x2 - x1) * (y2 - y1);
}

/**
 * Draw an image and bounding boxes, including class labels, probabilities, and dynamically generated colors per class.
 * @param {Buffer} file - the image file.
 * @param {Array} boxes - Array of bounding boxes with labels and probabilities.
 * Each box is [x1, y1, x2, y2, label (with probability)].
 */
export async function drawImageAndBoxesV8(file, boxes) {
  // Load the image
  const img = await loadImage(file);

  // Create a canvas and set dimensions to match the image
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  // Draw the image on the canvas
  ctx.drawImage(img, 0, 0);

  // Configure drawing styles
  ctx.font = `18px sans`;

  // Draw each bounding box
  for (const [x1, y1, x2, y2, label] of boxes) {
    // Extract class name from the label (e.g., "person (95.34%)" -> "person")
    const className = label.split(" (")[0];

    // Generate a unique color for each class dynamically
    const color = generateColorFromString(className);

    // Set stroke and fill colors for the current class
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    // Draw the rectangle
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    // Draw the label background
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(x1, y1 - 20, textWidth + 10, 25);

    // Draw the label text
    ctx.fillStyle = "#000000"; // Always use black for the label text for visibility
    ctx.fillText(label, x1 + 5, y1 - 3);
  }

  // Return the image buffer with bounding boxes and labels
  const buffer = canvas.toBuffer("image/jpeg");
  return buffer;
}

/**
 * Function used to draw bounding boxes on the image.
 * @param buf - Input image buffer
 * @param boxes - Array of bounding boxes in format [x1, y1, x2, y2, class_idx, score]
 * @returns Buffer with the image and boxes drawn
 */
export async function drawImageAndBoxesV11(buf, boxes) {
  // Load the image using canvas
  const img = await loadImage(buf);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");

  // Draw the image on the canvas
  ctx.drawImage(img, 0, 0, img.width, img.height);

  // Draw each bounding box on the image
  boxes.forEach(([x1, y1, x2, y2, classIdx, score]) => {
    // Draw a rectangle for the bounding box
    ctx.strokeStyle = "red"; // Red color for the bounding box
    ctx.lineWidth = 2; // Border width
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    // Draw the class label and confidence score near the box
    ctx.fillStyle = "red";
    ctx.font = "16px Arial";
    ctx.fillText(`Class ${classIdx}: ${score.toFixed(2)}`, x1, y1 - 5); // Display class and confidence
  });

  // Return the image as a buffer
  return canvas.toBuffer("image/jpeg");
}

/**
 * Array of YOLOv8 class labels
 */
export const yolo_classes = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
];

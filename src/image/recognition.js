import {
  loadModels,
  createFaceMatcher,
  displayBufferInBrowser,
  analyzeAndRecognize,
  drawFaceMasksWithFeatures,
  faceSwap,
} from "./tensorflow.js";
import { initializeOnnx, detect_objects_on_image } from "./onnx.js";
import { initializeCV, detectObjects } from "./opencv.js";
import camera, { videoCapture } from "./camera.js";
import puppeteer from "puppeteer";

export let faceMatcher = null;

export async function setup() {
  await loadModels();
  // await initializeCV();
  // await initializeOnnx(process.env.TTS ? "cpu" : "dml");
  await initializeOnnx();

  faceMatcher = await createFaceMatcher();
}

// Main function
export async function loop() {
  await setup();

  const browser = await puppeteer.launch({
    headless: false,
  });

  const page = (await browser.pages())[0];

  camera.videoCapture.addFrameListener(async (frame) => {
    try {
      // Analyze a sample image and recognize faces
      // const imageBuffer = await camera.takePictureJpeg(null);
      // const canvasOutput = await analyzeAndRecognize(imageBuffer, faceMatcher);

      const imageBuffer = await analyzeAndRecognize(frame.data, faceMatcher);
      // const imageBuffer = await drawFaceMasksWithFeatures(frame.data);

      // const imageBuffer = await faceSwap(
      //   frame.data,
      //   "C:/Projects/assistant/src/image/pictures/robert/robert-downey-2.png"
      // );

      // // Display the analyzed image in the same browser page
      // await displayCanvaInBrowser(canvasOutput, page);
      // await displayBufferInBrowser(imageBuffer, page);

      // // analyze with openCV yolov2-3
      // const modifiedBuffer = await detectObjects(
      //   canvasOutput.toBuffer("image/jpeg")
      // );
      // await displayBufferInBrowser(modifiedBuffer, page);

      // analyze with onnx yolov8
      const onnxBuffer = await detect_objects_on_image(imageBuffer);
      await displayBufferInBrowser(onnxBuffer, page);
    } catch (error) {
      console.log(error);
    }
  });

  await camera.videoCapture.start();
}

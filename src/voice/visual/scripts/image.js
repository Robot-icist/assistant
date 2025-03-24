let stream = null;

async function captureImage(facingMode = "user", stop = true) {
  try {
    if (stream == null)
      // Request camera access
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode }, // 'user' (front) or 'environment' (back)
      });

    // Create a video element to get the stream
    const video = document.createElement("video");
    video.srcObject = stream;

    // Wait for metadata to load before playing video
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    // Wait for the video to start rendering (remove unnecessary delay)
    while (video.videoWidth === 0 || video.videoHeight === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10)); // wait a bit for video dimensions
    }

    // Create a canvas to capture the image
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");

    // Capture the image directly from the video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to Blob (image buffer) asynchronously
    const imageBuffer = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg")
    );

    // Stop camera stream immediately after capture
    if (stop) stream.getTracks().forEach((track) => track.stop());

    return imageBuffer; // Returns image buffer (Blob)
  } catch (error) {
    console.error("Error capturing image:", error);
    throw new Error("Could not access camera. Please check permissions.");
  }
}

async function resizeImageBuffer(
  imageBuffer,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.7
) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions while maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;
        if (width > height) {
          width = maxWidth;
          height = Math.round(width / aspectRatio);
        } else {
          height = maxHeight;
          width = Math.round(height * aspectRatio);
        }
      }

      // Create a canvas and draw the resized image
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(img, 0, 0, width, height);

      // Convert the canvas to a Blob with compression
      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob) resolve(compressedBlob);
          else reject(new Error("Failed to compress image."));
        },
        "image/jpeg", // Change format if needed (e.g., "image/webp" for better compression)
        quality // Compression quality (0.0 to 1.0)
      );
    };

    img.onerror = () => reject(new Error("Invalid image buffer"));
    img.src = URL.createObjectURL(imageBuffer); // Convert Blob to object URL
  });
}

async function takePicture(facingMode = "user") {
  try {
    const imageBuffer = await captureImage(facingMode); // Capture image (from previous function)
    console.log("Original Image Size:", imageBuffer.size / 1024, "KB");

    const resizedBuffer = await resizeImageBuffer(imageBuffer, 600, 600, 0.6); // Resize & compress
    console.log("Resized Image Size:", resizedBuffer.size / 1024, "KB");

    WS.send(resizedBuffer);
    // Example: Create an image element to display the picture
    const img = document.createElement("img");
    img.style.position = "fixed";
    img.style.top = "50%";
    img.style.left = "50%";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
      img.style.height = "50vh";
    else img.style.height = "66vh";
    img.style.width = "auto";
    img.style.transform = "translate(-50%, -50%)";
    img.style.zIndex = "9999";
    img.src = URL.createObjectURL(resizedBuffer);
    document.body.prepend(img);
    img.addEventListener("click", () => {
      img.remove();
    });
    //setTimeout(() => img.remove(), 30000);
  } catch (err) {
    console.error(err.message);
  }
}

let isRunning = true; // External flag to control whether to keep running or stop

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startRecognition(facingMode = "user", interval = 500) {
  try {
    if (!isRunning) {
      console.log("Stopping the image capture process.");
      return (isRunning = true); // Stop the function if the flag is false
    }

    // Capture an image
    const imageBuffer = await captureImage(facingMode, false);
    console.log("Original Image Size:", imageBuffer.size / 1024, "KB");

    // Resize & compress the image
    const resizedBuffer = await resizeImageBuffer(imageBuffer, 600, 600, 0.25);
    console.log("Resized Image Size:", resizedBuffer.size / 1024, "KB");

    // Send the image
    WS1.send(resizedBuffer);

    // Wait for the specified interval before capturing the next image
    await delay(interval);

    // Recursively call the function to take the next image
    startRecognition(facingMode, interval);
  } catch (err) {
    console.error(err.message);
  }
}

// Function to stop the image capture process
function stopRecognition() {
  isRunning = false;
  stream.getTracks().forEach((track) => track.stop());
  // Check if there are any active tracks left
  const activeTracks = stream
    .getTracks()
    .filter((track) => track.readyState === "live");
  console.log("Active tracks:", activeTracks);
  stream = null;
  console.log("Recognition stopped.");
}

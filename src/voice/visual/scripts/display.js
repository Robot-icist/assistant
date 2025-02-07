const displayText = (
  text,
  timeout = 5000,
  fontFamily = "Doto",
  stream = false,
  id = "text-display"
) => {
  if (text.trim() == "") return document.getElementById(id)?.remove();
  let textDisplay = document.getElementById(id);
  if (!textDisplay) {
    textDisplay = document.createElement("div");
    textDisplay.id = id;
    textDisplay.style.fontFamily = fontFamily; //"Silkscreen"; //"Oxanium"; //"DO Futuristic"; //"Courier New";
    textDisplay.style.position = "fixed";
    textDisplay.style.top = "0"; // Start from the bottom
    textDisplay.style.left = "50%";
    textDisplay.style.transform = "translateX(-50%)";
    textDisplay.style.padding = "10px 20px";
    textDisplay.style.background = "rgba(0, 0, 0, 0.8)";
    textDisplay.style.color = "white";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
      textDisplay.style.fontSize = "12px";
    else textDisplay.style.fontSize = "24px";

    textDisplay.style.borderRadius = "10px";
    textDisplay.style.height = "auto"; // Ensure it doesn't overflow the screen width
    textDisplay.style.width = "auto"; // Ensure it doesn't overflow the screen width
    textDisplay.style.maxWidth = "90%"; // Ensure it doesn't overflow the screen width
    textDisplay.style.maxHeight = "33vh"; // Ensure it stays within the window height
    textDisplay.style.overflowY = "scroll"; // Enable scrolling if the content exceeds the container height
    textDisplay.style.overflowX = "scroll"; // Prevent horizontal overflow
    textDisplay.style.wordBreak = "break-word"; // Wrap long words to fit within the container
    textDisplay.style.whiteSpace = "normal";
    textDisplay.style.scrollbarWidth = "none";
    textDisplay.style.transition =
      "opacity 0.5s ease-in-out, top 1s ease-in-out"; // Smooth fade & move up
    textDisplay.style.opacity = "0"; // Start invisible
    document.body.appendChild(textDisplay);
  }

  if (stream) textDisplay.textContent += text;
  else textDisplay.textContent = text;

  textDisplay.style.opacity = "1";
  textDisplay.style.top = "33vh"; // Move to the third

  // Scroll to the bottom of the text content to show the latest part
  textDisplay.scrollTop = textDisplay.scrollHeight;
  textDisplay.scrollLeft = textDisplay.scrollWidth;

  clearTimeout(textDisplay.timeout);
  textDisplay.timeout = setTimeout(() => {
    textDisplay.style.opacity = "0";
    textDisplay.style.top = "0"; // Reset position for next time
    textDisplay.remove();
  }, timeout);
};

function showLoader() {
  // Create loader container element
  const loaderContainer = document.createElement("div");
  loaderContainer.id = "loader"; // Set the id to 'loader'
  loaderContainer.style.position = "fixed";
  loaderContainer.style.bottom = "0";
  loaderContainer.style.left = "0";
  loaderContainer.style.width = "100%";
  loaderContainer.style.height = "60px";
  loaderContainer.style.display = "flex";
  loaderContainer.style.justifyContent = "center";
  loaderContainer.style.alignItems = "center";
  // loaderContainer.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  loaderContainer.style.zIndex = "9999";

  // Create the loader (flash) element
  const loader = document.createElement("div");
  loader.className = "loader"; // Add class 'loader' for the styling you provided

  // Append the loader to the container
  loaderContainer.appendChild(loader);

  // Append the loader container to the body
  document.body.appendChild(loaderContainer);

  // Add the flash animation and other styles to the document
  const styleSheet = document.createElement("style");
  styleSheet.innerText = `
        .loader {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: #fff;
            box-shadow: 32px 0 #fff, -32px 0 #fff;
            position: relative;
            animation: flash 0.5s ease-out infinite alternate;
        }

        @keyframes flash {
            0% {
                background-color: #FFF2;
                box-shadow: 32px 0 #FFF2, -32px 0 #FFF;
            }
            50% {
                background-color: #FFF;
                box-shadow: 32px 0 #FFF2, -32px 0 #FFF2;
            }
            100% {
                background-color: #FFF2;
                box-shadow: 32px 0 #FFF, -32px 0 #FFF2;
            }
        }
    `;
  document.head.appendChild(styleSheet);

  // Return the loader container element to hide later if needed
  return loaderContainer;
}

function hideLoader() {
  // Find the loader by id and remove it
  const loaderContainer = document.getElementById("loader");
  if (loaderContainer) {
    loaderContainer.remove();
  }
}

function createStopButton(onClick) {
  const button = document.createElement("button");
  button.id = "stop";
  button.innerHTML = "🛑";
  button.style.all = "unset";
  button.style.cursor = "pointer";
  button.style.position = "fixed";
  button.style.fontSize = "33px";
  button.style.bottom = "0";
  button.style.left = "0";
  button.style.width = "100%";
  button.style.height = "30vh";
  button.style.display = "flex";
  button.style.justifyContent = "center";
  button.style.alignItems = "center";
  button.style.backgroundColor = "transparent";
  button.style.color = "white";
  button.style.zIndex = "9999";
  button.onclick = (e) => {
    e.preventDefault();
    onClick();
  };
  document.body.appendChild(button);
}

function hideStopButton() {
  // Find the loader by id and remove it
  const stopContainer = document.getElementById("stop");
  if (stopContainer) {
    stopContainer.remove();
  }
}

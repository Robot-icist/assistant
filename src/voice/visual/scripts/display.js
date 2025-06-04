// const displayText = (
//   text,
//   timeout = 5000,
//   fontFamily = "Doto",
//   stream = false,
//   id = "text-display"
// ) => {
//   if (text == "") return document.getElementById(id)?.remove();
//   let textDisplay = document.getElementById(id);
//   if (!textDisplay) {
//     textDisplay = document.createElement("div");
//     textDisplay.id = id;
//     textDisplay.style.fontFamily = fontFamily;
//     textDisplay.style.position = "fixed";
//     textDisplay.style.top = "0";
//     textDisplay.style.left = "50%";
//     textDisplay.style.transform = "translateX(-50%)";
//     textDisplay.style.padding = "10px 20px";
//     textDisplay.style.background = "rgba(0, 0, 0, 0.8)";
//     textDisplay.style.color = "white";
//     textDisplay.style.fontSize = /Mobi|Android|iPhone|iPad|iPod/i.test(
//       navigator.userAgent
//     )
//       ? "12px"
//       : "24px";
//     textDisplay.style.borderRadius = "10px";
//     textDisplay.style.height = "auto";
//     textDisplay.style.width = "auto";
//     textDisplay.style.maxWidth = "90%";
//     textDisplay.style.maxHeight = "33vh";
//     textDisplay.style.overflowY = "scroll";
//     textDisplay.style.overflowX = "scroll";
//     textDisplay.style.wordBreak = "break-word";
//     textDisplay.style.whiteSpace = "normal";
//     textDisplay.style.scrollbarWidth = "none";
//     textDisplay.style.transition =
//       "opacity 0.5s ease-in-out, top 1s ease-in-out";
//     textDisplay.style.opacity = "0";
//     document.body.appendChild(textDisplay);

//     // Attach event listeners to reset timeout on interaction
//     const resetTimeout = () => {
//       clearTimeout(textDisplay.timeout);
//       textDisplay.timeout = setTimeout(() => {
//         textDisplay.style.opacity = "0";
//         textDisplay.style.top = "0";
//         textDisplay.remove();
//       }, timeout);
//     };

//     textDisplay.addEventListener("touchstart", resetTimeout);
//     textDisplay.addEventListener("scroll", resetTimeout);
//     textDisplay.addEventListener("mousemove", resetTimeout);
//     textDisplay.addEventListener("click", resetTimeout);
//     textDisplay.addEventListener("hover", resetTimeout);
//   }

//   if (stream) textDisplay.textContent += text;
//   else textDisplay.textContent = text;

//   textDisplay.style.opacity = "1";
//   textDisplay.style.top = /Mobi|Android|iPhone|iPad|iPod/i.test(
//     navigator.userAgent
//   )
//     ? "30vh"
//     : "33vh";
//   textDisplay.scrollTop = textDisplay.scrollHeight;
//   textDisplay.scrollLeft = textDisplay.scrollWidth;

//   clearTimeout(textDisplay.timeout);
//   textDisplay.timeout = setTimeout(() => {
//     textDisplay.style.opacity = "0";
//     textDisplay.style.top = "0";
//     textDisplay.remove();
//   }, timeout);
// };

const displayText = (
  text,
  timeout = 5000,
  fontFamily = "Doto",
  stream = false,
  id = "text-display",
  allowHTML = false
) => {
  if (text == "") return document.getElementById(id)?.remove();

  let textDisplay = document.getElementById(id);
  if (!textDisplay) {
    textDisplay = document.createElement("div");
    textDisplay.id = id;
    textDisplay.style.fontFamily = fontFamily;
    textDisplay.style.position = "fixed";
    textDisplay.style.top = "0";
    textDisplay.style.left = "50%";
    textDisplay.style.transform = "translateX(-50%)";
    textDisplay.style.padding = "10px 20px";
    textDisplay.style.background = "rgba(0, 0, 0, 0.8)";
    textDisplay.style.color = "white";
    textDisplay.style.fontSize = /Mobi|Android|iPhone|iPad|iPod/i.test(
      navigator.userAgent
    )
      ? "12px"
      : "24px";
    textDisplay.style.borderRadius = "10px";
    textDisplay.style.height = "auto";
    textDisplay.style.width = "auto";
    textDisplay.style.maxWidth = "90%";
    textDisplay.style.maxHeight = "33vh";
    textDisplay.style.overflowY = "scroll";
    textDisplay.style.overflowX = "scroll";
    textDisplay.style.wordBreak = "break-word";
    textDisplay.style.whiteSpace = "normal";
    textDisplay.style.scrollbarWidth = "none";
    textDisplay.style.transition =
      "opacity 0.5s ease-in-out, top 1s ease-in-out";
    textDisplay.style.opacity = "0";
    document.body.appendChild(textDisplay);

    // Attach event listeners to reset timeout on interaction
    const resetTimeout = () => {
      clearTimeout(textDisplay.timeout);
      textDisplay.timeout = setTimeout(() => {
        textDisplay.style.opacity = "0";
        textDisplay.style.top = "0";
        textDisplay.remove();
      }, timeout);
    };

    textDisplay.addEventListener("touchstart", resetTimeout);
    textDisplay.addEventListener("scroll", resetTimeout);
    textDisplay.addEventListener("mousemove", resetTimeout);
    textDisplay.addEventListener("click", resetTimeout);
    textDisplay.addEventListener("hover", resetTimeout);
  }

  if (allowHTML) {
    textDisplay.innerHTML = text; // Use innerHTML for HTML rendering
  } else {
    if (stream) textDisplay.textContent += text;
    else textDisplay.textContent = text;
  }

  textDisplay.style.opacity = "1";
  textDisplay.style.top = /Mobi|Android|iPhone|iPad|iPod/i.test(
    navigator.userAgent
  )
    ? "30vh"
    : "33vh";
  textDisplay.scrollTop = textDisplay.scrollHeight;
  textDisplay.scrollLeft = textDisplay.scrollWidth;

  clearTimeout(textDisplay.timeout);
  textDisplay.timeout = setTimeout(() => {
    textDisplay.style.opacity = "0";
    textDisplay.style.top = "0";
    textDisplay.remove();
  }, timeout);
};

function hideLLMText() {
  const llmText = document.getElementById("text-display-llm");
  if (llmText) llmText.remove();
}

function hideText() {
  const llmText = document.getElementById("text-display");
  if (llmText) llmText.remove();
}

function showLoader(numDots = 9) {
  const loaderContainer = document.createElement("div");
  loaderContainer.id = "loader";
  loaderContainer.className = "loader";
  loaderContainer.style.position = "fixed";
  loaderContainer.style.bottom = "0";
  loaderContainer.style.left = "0";
  loaderContainer.style.width = "100%";
  loaderContainer.style.height = "60px";
  loaderContainer.style.display = "flex";
  loaderContainer.style.justifyContent = "center";
  loaderContainer.style.alignItems = "center";
  loaderContainer.style.zIndex = "9999";

  // Create dots based on parameter
  for (let i = 0; i < numDots; i++) {
    const dot = document.createElement("div");
    dot.className = "loader-dot";
    dot.style.animationDelay = `${-1.2 + (i * 1.2 / numDots)}s`;
    loaderContainer.appendChild(dot);
  }

  document.body.appendChild(loaderContainer);

  const styleSheet = document.createElement("style");
  styleSheet.innerText = `
    .loader-dot {
      width: ${Math.max(4, Math.min(16, 48/numDots))}px;
      height: ${Math.max(4, Math.min(16, 48/numDots))}px;
      margin: 0 ${Math.max(2, Math.min(8, 24/numDots))}px;
      background-color: #fff;
      border-radius: 50%;
      display: inline-block;
      animation: wave 1.2s ease-in-out infinite;
      transition: all 0.3s ease;
    }

    @keyframes wave {
      0%, 60%, 100% {
        transform: translateY(0);
      }
      30% {
        transform: translateY(-15px);
      }
    }
  `;
  document.head.appendChild(styleSheet);

  return loaderContainer;
}

function hideLoader() {
  // Find the loader by id and remove it
  const loaderContainers = document.getElementsByClassName("loader");
  if (loaderContainers.length > 0) {
    for (let i = 0; i < loaderContainers.length; i++) {
      const loaderContainer = loaderContainers[i];
      if (loaderContainer) {
        loaderContainer.remove();
      }
    }
  }
}

function createStopButton(onClick) {
  //hideStopButton();
  button = document.createElement("button");
  button.id = "stop";
  // button.innerHTML = "🛑";
  button.innerHTML = "◻️";
  button.style.all = "unset";
  button.style.cursor = "pointer";
  button.style.position = "fixed";
  button.style.fontSize = "33px";
  button.style.bottom = "0";
  button.style.left = "0";
  button.style.width = "100%";
  button.style.height = "20vh";
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
  while (document.getElementById("stop") != null) {
    const stopContainer = document.getElementById("stop");
    if (stopContainer) {
      stopContainer.remove();
    }
  }
}

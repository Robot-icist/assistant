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

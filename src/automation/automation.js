import {
  existsSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import globalMouseEvents from "global-mouse-events";
import {
  mouse,
  keyboard,
  screen,
  Key,
  Button,
  sleep,
  useConsoleLogger,
  ConsoleLogLevel,
} from "@nut-tree-fork/nut-js";
import { GlobalKeyboardListener } from "node-global-key-listener";
import {
  mapGlobalKeyToNutKey,
  mapXToScreen,
  mapYToScreen,
} from "../utils/mapping.js";
import { LOG } from "../utils/log.js";
import { rl } from "../utils/rl.js";
import { speak, stopSpeaking } from "../voice/speak.js";
import { exec } from "child_process";

import path from "path";
import { fileURLToPath } from "url";
import { stopMicRecognition } from "../voice/recognition.js";
import { Kill, setProcessing, Stop } from "../../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEBUG = process.env.DEBUG || false;
useConsoleLogger({
  logLevel: DEBUG ? ConsoleLogLevel.DEBUG : ConsoleLogLevel.ERROR,
});

let resolutionHeight = 0;
let resolutionWidth = 0;
let screenHeight = 0;
let screenWidth = 0;

(async () => {
  const grab = await screen.grab();
  resolutionHeight = grab.height;
  resolutionWidth = grab.width;
  screenHeight = await screen.height();
  screenWidth = await screen.width();
})();

const eventsDirectory = path.resolve(__dirname, "./recordings/");
const recordingNames = existsSync(eventsDirectory)
  ? readdirSync(eventsDirectory).map((file) => file.replace(".json", ""))
  : [];

if (!existsSync(eventsDirectory)) {
  mkdirSync(eventsDirectory);
}

const keyboardListener = new GlobalKeyboardListener();

const recordedEvents = []; // Unified array for mouse and keyboard events

// Load Events from File
function loadEventsFromFile(recordingName) {
  try {
    const filePath = `${eventsDirectory}${recordingName}.json`;
    if (existsSync(filePath)) {
      const data = readFileSync(filePath, "utf8");
      recordedEvents.length = 0; // Clear current events
      recordedEvents.push(...JSON.parse(data).events); // Load events
      console.log(`Loaded events from "${recordingName}" recording.`);
    } else {
      console.log(`No recording found with the name "${recordingName}".`);
    }
  } catch (error) {
    console.log("Error loading events from file:", error);
  }
}

// Save Events to File
function saveEventsToFile(recordingName) {
  const eventsData = { events: recordedEvents };

  try {
    const filePath = `${eventsDirectory}${recordingName}.json`;
    writeFileSync(filePath, JSON.stringify(eventsData, null, 2));
    console.log(`Recorded events saved to file "${recordingName}.json".`);
    if (!recordingNames.includes(recordingName))
      recordingNames.push(recordingName);
  } catch (error) {
    console.log("Error saving events to file:", error);
  }
}

// Mouse Events
globalMouseEvents.on("mousemove", async (event) => {
  LOG("mousemove: ", event);
  if (isRecording) {
    recordedEvents.push({
      type: "mousemove",
      x: event.x,
      y: event.y,
      time: Date.now(),
    });
  }
});

globalMouseEvents.on("mousedown", (event) => {
  LOG("mousedown", event);
  if (isRecording) {
    recordedEvents.push({
      type: "mousedown",
      button: event.button,
      x: event.x,
      y: event.y,
      time: Date.now(),
    });
  }
});

globalMouseEvents.on("mouseup", (event) => {
  LOG("mouseup", event);
  if (isRecording) {
    recordedEvents.push({
      type: "mouseup",
      button: event.button,
      x: event.x,
      y: event.y,
      time: Date.now(),
    });
  }
});

globalMouseEvents.on("mousewheel", (event) => {
  LOG("mousewheel", event);
  if (isRecording) {
    recordedEvents.push({
      type: "mousewheel",
      delta: event.delta,
      x: event.x,
      y: event.y,
      axis: event.axis,
      time: Date.now(),
    });
  }
});

// Keyboard Events
keyboardListener.addListener((event) => {
  LOG(event);
  if (isRecording) {
    recordedEvents.push({
      type: event.state === "DOWN" ? "keydown" : "keyup",
      key: event.name,
      time: Date.now(),
    });
  }
});

//Capture CTRL + C
keyboardListener.addListener(async function (e, down) {
  if (e.state == "DOWN" && e.name == "C" && down["LEFT CTRL"]) {
    //Kill();
  }
});

//Capture CTRL + S
keyboardListener.addListener(async function (e, down) {
  if (e.state == "DOWN" && e.name == "S" && down["LEFT CTRL"]) {
    Stop();
  }
});

//Capture CTRL + K
keyboardListener.addListener(async function (e, down) {
  if (e.state == "DOWN" && e.name == "K" && down["LEFT CTRL"]) {
  }
});

//ENTER
keyboardListener.addListener(async function (e, down) {
  if (e.state == "DOWN" && e.name == "RETURN") {
    try {
    } catch (error) {}
  }
});

//ESCAPE
keyboardListener.addListener(function (e, down) {
  if (e.state == "DOWN" && e.name == "ESCAPE") {
    Kill();
  }
});

function startRecording() {
  if (isRecording) {
    return;
  }
  console.log(`Started recording events for "${currentRecordingName}"...`);
  isRecording = true;
  recordedMouseEvents = [];
  recordedKeyboardEvents = [];
}

function stopRecording() {
  isRecording = false;
  if (!currentRecordingName) return;
  console.log(`Stopped recording events for "${currentRecordingName}".`);
  saveEventsToFile(currentRecordingName);
}

async function replayEvents() {
  recordedEvents.sort((a, b) => a.time - b.time); // Ensure events are sorted by time

  for (let i = 0; i < recordedEvents.length; i++) {
    const event = recordedEvents[i];
    const delay = i === 0 ? 0 : event.time - recordedEvents[i - 1].time;
    await sleep(delay); // Maintain the recorded delay between events

    if (event.type.startsWith("mouse")) {
      // Handle mouse events
      switch (event.type) {
        case "mousemove":
          mouse.move({
            x: mapXToScreen(event.x, resolutionWidth, screenWidth),
            y: mapYToScreen(event.y, resolutionHeight, screenHeight),
          });
          break;
        case "mousedown":
          mouse.move({
            x: mapXToScreen(event.x, resolutionWidth, screenWidth),
            y: mapYToScreen(event.y, resolutionHeight, screenHeight),
          });
          mouse.pressButton(event.button === 1 ? Button.LEFT : Button.RIGHT);
          break;
        case "mouseup":
          mouse.move({
            x: mapXToScreen(event.x, resolutionWidth, screenWidth),
            y: mapYToScreen(event.y, resolutionHeight, screenHeight),
          });
          mouse.releaseButton(event.button === 1 ? Button.LEFT : Button.RIGHT);
          break;
        case "mousewheel":
          mouse.move({
            x: mapXToScreen(event.x, resolutionWidth, screenWidth),
            y: mapYToScreen(event.y, resolutionHeight, screenHeight),
          });
          if (event.delta > 0) {
            mouse.scrollUp(event.delta);
          } else if (event.delta < 0) {
            mouse.scrollDown(-event.delta);
          }
          break;
      }
    } else if (event.type.startsWith("key")) {
      // Handle keyboard events
      const nutKey = mapGlobalKeyToNutKey(event.key);
      if (nutKey) {
        if (event.type === "keydown") {
          keyboard.pressKey(nutKey);
        } else if (event.type === "keyup") {
          keyboard.releaseKey(nutKey);
        }
      } else {
        console.log(`Unmapped or unsupported key: ${event.key}`);
      }
    }
  }
  console.log("Replay finished.");
}

export const playActions = async (actions) => {
  // let actions = [
  //             ...
  //             { "type": "mouse", "action": "move", "x": 0, "y": 0, "time": 1000 },
  //             { "type": "mouse", "action": "click", "x": 615, "y": 1045, "time": 1000 },
  //             { "type": "mouse", "action": "wheel", "delta": 100, "time": 2500 },
  //             { "type": "keyboard", "keys": "WIN R", "time": 1000 },
  //             { "type": "keyboard", "keys": "c", "time": 1000 },
  //             { "type": "keyboard", "keys": "m", "time": 1000 },
  //             { "type": "keyboard", "keys": "d", "time": 1000 },
  //             { "type": "keyboard", "keys": "ENTER", "time": 2000 }
  //              ...
  //         ]
  // Play actions with timing
  console.log("Playing actions...");
  let previousTime = 0;
  for (const action of actions) {
    const { type, time } = action;

    // Wait for the specified time since the previous action
    await new Promise((resolve) => setTimeout(resolve, previousTime));
    previousTime = time;

    if (type === "mouse") {
      const { action: mouseAction, x, y, delta } = action;
      if (mouseAction === "move") {
        mouse.move({
          x: mapXToScreen(x, resolutionWidth, screenWidth),
          y: mapYToScreen(y, resolutionHeight, screenHeight),
        });
      } else if (mouseAction === "click") {
        mouse.move({
          x: mapXToScreen(x, resolutionWidth, screenWidth),
          y: mapYToScreen(y, resolutionHeight, screenHeight),
        });
        mouse.leftClick();
      } else if (mouseAction === "wheel") {
        mouse.move({
          x: mapXToScreen(x, resolutionWidth, screenWidth),
          y: mapYToScreen(y, resolutionHeight, screenHeight),
        });
        if (delta > 0) {
          mouse.scrollUp(delta);
        } else if (delta < 0) {
          mouse.scrollDown(delta);
        }
      }
    } else if (type === "keyboard") {
      const { keys } = action;

      // Split combination keys and process each
      const keySequence = keys.trim().split(" ");
      console.log(keySequence);
      if (keySequence.length > 1) {
        // For combinations, hold keys
        console.log("is a combination", keySequence);
        for (const key of keySequence) {
          keyboard.pressKey(mapGlobalKeyToNutKey(key.toUpperCase()));
        }
        for (const key of keySequence.reverse()) {
          keyboard.releaseKey(mapGlobalKeyToNutKey(key.toUpperCase()));
        }
      } else if (keySequence.length === 1) {
        const isAKnowMappedKey = mapGlobalKeyToNutKey(
          keySequence[0].toUpperCase()
        );
        if (isAKnowMappedKey) {
          keyboard.pressKey(mapGlobalKeyToNutKey(keySequence[0].toUpperCase()));
          keyboard.releaseKey(
            mapGlobalKeyToNutKey(keySequence[0].toUpperCase())
          );
        } else {
          [...keySequence[0]].forEach((char) => {
            keyboard.pressKey(mapGlobalKeyToNutKey(char.toUpperCase()));
            keyboard.releaseKey(mapGlobalKeyToNutKey(char.toUpperCase()));
          });
        }
      }
    }
  }

  console.log("Actions played successfully!");
};

function findRecordings(query) {
  const matches = recordingNames
    .map((name) => {
      const filePath = `${eventsDirectory}${name}.json`;
      if (existsSync(filePath)) {
        // const data = fs.readFileSync(filePath, 'utf8');
        return { name };
      }
      return null;
    })
    .filter((recording) => recording && recording.name.includes(query));

  return matches;
}

export async function replayMatchingRecordings(query) {
  const matches = findRecordings(query);
  if (matches.length === 0) {
    console.log(`No recordings found matching "${query}".`);
    return;
  }

  console.log(`Found ${matches.length} recording(s) matching "${query}":`);
  matches.forEach((rec, index) => {
    console.log(`${index + 1}. Name: "${rec.name}"`);
  });

  const selectedRecording = matches[0];
  console.log(`Replaying "${selectedRecording.name}"...`);
  loadEventsFromFile(selectedRecording.name);
  await replayEvents();
  console.log("Playback finished.");
}

let isRecording = false;
let currentRecordingName = "";

export const automation = () => {
  try {
    rl.question("Please enter a recording name: ", async (name) => {
      LOG("resolution: ", resolutionHeight, resolutionWidth);
      LOG("screen: ", screenHeight, screenWidth);

      if (!name.trim()) {
        console.log("Recording name is required.");
        automation();
        return;
      }

      currentRecordingName = name.trim();
      console.log(`Recording name set to "${currentRecordingName}".`);
      rl.setPrompt(
        "Enter command (r to record, s to stop, p to play, e to execute): "
      );
      rl.prompt();

      rl.on("line", async (input) => {
        const command = input.trim();

        if (command === "r") {
          if (isRecording) {
            console.log("Already recording. Stop the current recording first.");
            rl.prompt();
            return;
          }
          startRecording();
          rl.prompt();
        }

        if (command === "s") {
          if (!isRecording) {
            console.log("No recording is currently active.");
            rl.prompt();
            return;
          }

          stopRecording();
          automation();
        }

        if (command === "p") {
          loadEventsFromFile(currentRecordingName);
          await replayEvents();
          rl.prompt();
        }

        if (command === "e") {
          rl.question("Enter part of the recording name: ", async (query) => {
            await replayMatchingRecordings(query);
            rl.prompt();
          });
        }

        rl.prompt();
      });
    });
  } catch (error) {
    console.log(error);
    automation();
  }
};

export default { automation, replayMatchingRecordings, playActions };

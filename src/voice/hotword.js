import os from "os";
import { runExecutableWithArgs } from "../utils/processRunner.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

const isMac = os.type() == "Darwin";
const isWindows = os.type().indexOf("Windows") > -1;
let word;

export const getHotword = () => {
  if (word != null) return word;
  if (!process.env.CUSTOM) {
    word = process.env.HOTWORD ? process.env.HOTWORD : "jarvis";
  } else word = process.env.HOTWORD ? process.env.HOTWORD : "pierre";
  return word;
};

export const setHotword = (val) => {
  word = val;
};

export let selectedHotword = getHotword();

export const hotword = (
  callback,
  keywords = selectedHotword,
  sensitivities = "0,8",
  audioDeviceIndex = "0"
) => {
  // Executable configuration
  const runtime = isMac ? "osx" : isWindows ? "win" : "linux";
  const executable = `${__dirname}/../dotnet/PorcupineDotnet/bin/Release/net8.0/${runtime}-x64/PorcupineDotnet`;
  const args = [
    "--keywords",
    keywords,
    "--sensitivities",
    sensitivities,
    "--audio_device_index",
    audioDeviceIndex,
  ];

  // Run the keyword-detection executable
  runExecutableWithArgs(executable, args, callback);
};

export const customHotword = (
  callback,
  refJsonPath = `C:/Projects/assistant/src/voice/hotwords/${selectedHotword}/${selectedHotword}_ref.json`,
  hotwordName = selectedHotword,
  threshold = 0.725,
  relaxationTime = 0.8
) => {
  const pythonScriptPath = path.join(__dirname, "../python/hotword.py");
  const args = [
    pythonScriptPath,
    "--ref-json-path",
    refJsonPath,
    "--hotword-name",
    hotwordName,
    "--threshold",
    threshold.toString(),
    "--relaxation-time",
    relaxationTime.toString(),
  ];

  // Run the keyword-detection executable
  runExecutableWithArgs("python", args, callback);
};

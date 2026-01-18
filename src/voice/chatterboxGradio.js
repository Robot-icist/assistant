import { Client } from "@gradio/client";
import fs from "fs/promises";
import path from "path";

async function fetchFileAsBlob(filePath) {
  const absolutePath = path.resolve(filePath);
  const fileBuffer = await fs.readFile(absolutePath);
  return new Blob([fileBuffer]);
}

/**
 * Call the Chatterbox Gradio endpoint `/generate_tts_audio`.
 *
 * Parameters correspond to the Gradio demo inputs:
 * - textInput (string)
 * - languageId (string)
 * - speakerAudioUrlOrPath (URL or local path to reference audio) (optional)
 * - exaggeration (number) default 0.5
 * - temperature (number) default 0.8
 * - seedNum (number) default 0
 * - cfgw (number) default 0.5
 */
export async function chatterboxGradio(
  textInput = "Le mois dernier, nous avons atteint un nouveau jalon avec deux milliards de vues sur notre chaîne YouTube.",
  languageId = "fr",
  speakerAudioUrlOrPath = null,
  exaggeration = 0.5,
  temperature = 0.8,
  seedNum = 0,
  cfgw = 1
) {
  let audioBlob = null;

  if (speakerAudioUrlOrPath) {
    if (typeof speakerAudioUrlOrPath === "string" && speakerAudioUrlOrPath.startsWith("http")) {
      const responseAudio = await fetch(speakerAudioUrlOrPath);
      if (!responseAudio.ok) {
        throw new Error(`Failed to fetch audio from URL: ${responseAudio.statusText}`);
      }
      audioBlob = await responseAudio.blob();
    } else {
      // assume local path
      audioBlob = await fetchFileAsBlob(speakerAudioUrlOrPath);
    }
  }

  const client = await Client.connect("http://127.0.0.1:7860/");

  const result = await client.predict("/generate_tts_audio", {
    text_input: textInput,
    language_id: languageId,
    audio_prompt_path_input: audioBlob, // blob or null
    exaggeration_input: exaggeration,
    temperature_input: temperature,
    seed_num_input: seedNum,
    cfgw_input: cfgw,
  });

  return result.data; // return whatever the Gradio app responds with (typically an audio file or FileData)
}

export { fetchFileAsBlob };

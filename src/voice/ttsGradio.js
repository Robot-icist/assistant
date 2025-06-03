import { Client } from "@gradio/client";
import fs from "fs/promises";
import path from "path";

async function fetchFileAsBlob(filePath) {
    const absolutePath = path.resolve(filePath);
    const fileBuffer = await fs.readFile(absolutePath);
    return new Blob([fileBuffer]);
}

async function ttsGradio(prompt, language, audioInputUrlOrPath) {
    let exampleAudio;
		if (audioInputUrlOrPath.startsWith("http")) {
			const responseAudio = await fetch(audioInputUrlOrPath);
			exampleAudio = await responseAudio.blob();
		} else {
			exampleAudio = await fetchFileAsBlob(audioInputUrlOrPath);
		}

    const client = await Client.connect("http://127.0.0.1:7860/");
    const result = await client.predict("/predict", {
        prompt,
        language,
        audio_file_pth: exampleAudio,
        agree: true,
    });

    return result.data;
}

// New function to call the /synthesize endpoint
async function xttsGradio(textInput, languageName, speakerAudioUrlOrPath) {
    let speakerAudioBlob;

    if (speakerAudioUrlOrPath.startsWith("http")) {
        const responseAudio = await fetch(speakerAudioUrlOrPath);
        if (!responseAudio.ok) {
            throw new Error(`Failed to fetch audio from URL: ${responseAudio.statusText}`);
        }
        speakerAudioBlob = await responseAudio.blob();
    } else {
        speakerAudioBlob = await fetchFileAsBlob(speakerAudioUrlOrPath);
    }

    const client = await Client.connect("http://127.0.0.1:7860/"); // Assuming same Gradio instance
    const result = await client.predict("/synthesize", {
        text_input: textInput,         // Mapped from your example
        speaker_wav_path: speakerAudioBlob, // Mapped from your example
        language_name: languageName,   // Mapped from your example
    });

    // The structure of result.data depends on what your Gradio API returns.
    // Typically, it's an array. If it returns an audio file, it might be like:
    // result.data[0] (for a single output component)
    // or result.data (if the API directly returns the file data in a specific structure)
    // For your example, it seems result.data itself is what you need.
    return result.data;
}

export { ttsGradio, xttsGradio, fetchFileAsBlob };
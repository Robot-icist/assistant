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

export { ttsGradio, fetchFileAsBlob };
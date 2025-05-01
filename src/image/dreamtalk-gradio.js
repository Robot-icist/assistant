import { Client } from "@gradio/client";
import fs from "fs/promises";
import path from "path";

async function fetchFileAsBlob(filePath) {
    const absolutePath = path.resolve(filePath);
    const fileBuffer = await fs.readFile(absolutePath);
    return new Blob([fileBuffer]);
}

async function dreamtalkGradio(audioInputUrlOrPath, imagePathUrlOrPath, emotionalStyle = "M030_front_neutral_level1_001.mat") {
    let exampleAudio;
    if (audioInputUrlOrPath.startsWith("http")) {
        const responseAudio = await fetch(audioInputUrlOrPath);
        exampleAudio = await responseAudio.blob();
    } else {
        exampleAudio = await fetchFileAsBlob(audioInputUrlOrPath);
    }

    let exampleImage;
    if (imagePathUrlOrPath.startsWith("http")) {
        const responseImage = await fetch(imagePathUrlOrPath);
        exampleImage = await responseImage.blob();
    } else {
        exampleImage = await fetchFileAsBlob(imagePathUrlOrPath);
    }

    const client = await Client.connect("http://127.0.0.1:7861/");
    const result = await client.predict("/infer", {
        audio_input: exampleAudio,
        image_path: exampleImage,
        emotional_style: emotionalStyle,
    });
    return result.data;
}

export { dreamtalkGradio, fetchFileAsBlob };
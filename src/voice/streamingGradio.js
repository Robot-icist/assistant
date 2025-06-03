import { Client } from "@gradio/client";
import { writeFileSync } from 'fs';
import { join } from 'path';
// const fetch = require('node-fetch'); // For Node.js < 18, or if global fetch isn't available

async function main() {
    const APP_URL = "http://localhost:7860/"; // Change if your Gradio app runs elsewhere
    const OUTPUT_FILENAME = "streamed_audio_from_gradio.wav";

    console.log(`JS: Connecting to Gradio app at ${APP_URL}...`);
    let app;
    try {
        app = await Client.connect(APP_URL);
        console.log("JS: Successfully connected to Gradio app.");
    } catch (error) {
        console.error("JS: Failed to connect to Gradio app:", error);
        return;
    }

    console.log("JS: Submitting job to 'stream_wav_data' endpoint...");
    const job = app.submit("/stream_wav_data", {}); // Corresponds to api_name

    let wavHeaderBytes = null;
    const pcmDataChunks = [];
    let receivedChunkIndex = 0;

    try {
        for await (const event of job) {
            if (event.type === "data") {
                // Each 'data' event corresponds to a 'yield' from the Python generator
                // event.data[0] will contain file metadata for the gr.File output
                const fileData = event.data[0]; 
                
                if (!fileData || !fileData.url) {
                    console.warn("JS: Received event without file URL:", event);
                    continue;
                }

                console.log(`JS: Received data chunk ${receivedChunkIndex}. Downloading from: ${fileData.url}`);
                
                const response = await fetch(fileData.url);
                if (!response.ok) {
                    throw new Error(`JS: Failed to download chunk ${receivedChunkIndex} from ${fileData.url}: ${response.statusText}`);
                }
                const buffer = await response.arrayBuffer();
                const chunkBytes = Buffer.from(buffer);

                if (receivedChunkIndex === 0) {
                    wavHeaderBytes = chunkBytes;
                    console.log(`JS: Stored WAV header (${wavHeaderBytes.length} bytes).`);
                } else {
                    pcmDataChunks.push(chunkBytes);
                    console.log(`JS: Stored PCM chunk ${receivedChunkIndex} (${chunkBytes.length} bytes). Total PCM chunks: ${pcmDataChunks.length}`);
                }
                receivedChunkIndex++;

            } else if (event.type === "status") {
                console.log(`JS: Job status update: ${event.stage}` + (event.progress_data ? ` - Progress: ${JSON.stringify(event.progress_data[0])}` : ""));
                if (event.stage === "complete") {
                    console.log("JS: Server indicated stream completion via job status.");
                }
            } else if (event.type === "log") {
                console.log(`JS: Server Log: ${event.log} (Level: ${event.level})`);
            }
        }
        console.log("JS: Async iteration for job events finished.");

    } catch (error) {
        console.error("JS: Error during streaming job:", error);
        return;
    }

    if (!wavHeaderBytes || pcmDataChunks.length === 0) {
        console.log("JS: Did not receive enough data to form a WAV file.");
        return;
    }

    // Concatenate all PCM data chunks
    const totalPcmData = Buffer.concat(pcmDataChunks);
    console.log(`JS: Total PCM data collected: ${totalPcmData.length} bytes.`);

    // --- CRITICAL STEP: Update WAV Header Sizes ---
    // The header received from Python might have placeholder sizes.
    // We need to update them with the actual size of the PCM data.
    // A standard WAV header is 44 bytes.
    // - Subchunk2Size (data size) is at offset 40 (4 bytes, Little Endian)
    // - ChunkSize (RIFF chunk size: total file size - 8) is at offset 4 (4 bytes, Little Endian)

    if (wavHeaderBytes.length >= 44) {
        // Update Subchunk2Size (actual size of the data)
        wavHeaderBytes.writeUInt32LE(totalPcmData.length, 40);
        
        // Update ChunkSize (overall file size minus 8 bytes for 'RIFF' and this size field itself)
        // ChunkSize = (Header Size - 8) + Data Size = 36 + totalPcmData.length
        const riffChunkSize = 36 + totalPcmData.length;
        wavHeaderBytes.writeUInt32LE(riffChunkSize, 4);
        
        console.log(`JS: Updated WAV header: DataSize=${totalPcmData.length}, RiffChunkSize=${riffChunkSize}`);
    } else {
        console.warn("JS: Received header is shorter than 44 bytes. Size update might be incorrect.");
    }

    // Combine header and PCM data
    const finalWavData = Buffer.concat([wavHeaderBytes, totalPcmData]);

    // Save the complete WAV file
    const outputPath = join(__dirname, OUTPUT_FILENAME);
    try {
        writeFileSync(outputPath, finalWavData);
        console.log(`JS: Complete WAV file saved to: ${outputPath} (${finalWavData.length} bytes)`);
        console.log("JS: You can now play this file with any standard audio player.");
    } catch (error) {
        console.error("JS: Error writing final WAV file:", error);
    }
}

main().catch(console.error);
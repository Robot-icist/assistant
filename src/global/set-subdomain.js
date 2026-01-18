import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');
const tunnelPath = path.resolve(__dirname, './tunnel.js');
const wsHandlerPath = path.resolve(__dirname, '../voice/visual/scripts/websockethandler.js');
const whisperHtmlPath = path.resolve(__dirname, '../python/whisper_streaming_web/web/live_transcription.html');

let subdomain = process.env.SUBDOMAIN;

if (!subdomain) {
  // Generate a random intelligible subdomain
  const adjectives = ['happy', 'sad', 'big', 'small', 'fast', 'slow', 'bright', 'dark', 'loud', 'quiet', 'hot', 'cold', 'soft', 'hard', 'sweet', 'sour', 'red', 'blue', 'green', 'yellow'];
  const nouns = ['cat', 'dog', 'house', 'car', 'tree', 'river', 'mountain', 'ocean', 'bird', 'fish', 'sun', 'moon', 'star', 'cloud', 'wind', 'rain', 'snow', 'fire', 'earth', 'sky', 'ai', 'web', 'bot', 'app', 'net', 'code', 'data', 'cloud', 'server', 'client', 'api', 'hub', 'node', 'link', 'gate', 'port', 'stream', 'wave', 'pulse', 'core'];
  const adj = adjectives[crypto.randomInt(0, adjectives.length)];
  const noun0 = nouns[crypto.randomInt(0, nouns.length)];
  // const noun1 = nouns[crypto.randomInt(0, nouns.length)];
  // subdomain = `${adj}-${noun0}-${noun1}`;
  subdomain = `${adj}-${noun0}`;
  console.log(`Generated subdomain: ${subdomain}`);

//   // Check if .env exists
//   let envContent = '';
//   if (fs.existsSync(envPath)) {
//     envContent = fs.readFileSync(envPath, 'utf8');
//   }

//   // Check if SUBDOMAIN is already in .env
//   if (!envContent.includes('SUBDOMAIN=')) {
//     envContent += `\nSUBDOMAIN=${subdomain}\n`;
//     fs.writeFileSync(envPath, envContent.trim() + '\n');
//     console.log('Added SUBDOMAIN to .env');
//   } else {
//     console.log('SUBDOMAIN already in .env, using existing');
//     // If it exists but not loaded, perhaps reload, but for now, assume it's set
//   }
} else {
  console.log(`Using subdomain from env: ${subdomain}`);
}

// Now replace in the browser file
const replaceSubdomain = (filePath) => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Find the current subdomain value
    const match = content.match(/(export const |const )subdomain = "([^"]+)"/);
    if (match) {
      const currentSubdomain = match[2];
      content = content.replace(new RegExp(currentSubdomain, 'g'), subdomain);
      fs.writeFileSync(filePath, content);
      console.log(`Replaced subdomain in ${path.basename(filePath)} from ${currentSubdomain} to ${subdomain}`);
    } else {
      console.log(`Subdomain declaration not found in ${path.basename(filePath)}`);
    }
  } else {
    console.log(`File not found: ${filePath}`);
  }
};

replaceSubdomain(tunnelPath);
replaceSubdomain(wsHandlerPath);
replaceSubdomain(whisperHtmlPath);
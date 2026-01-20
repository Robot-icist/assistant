#!/usr/bin/env node

import { spawn } from "child_process";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log(__filename); 
console.log(process.cwd());

const child = spawn("npm", ["run", "vsfrtts"], {
  stdio: "inherit",
  shell: true, // Use shell to ensure command is found on all platforms // false is safer when calling a direct binary
  cwd: __dirname,
});

child.on("exit", (code) => {
  process.exit(code);
});

#!/usr/bin/env node

import { spawn } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.log(__filename); 

console.log(process.cwd());

// Resolve local npm-run-all binary path
const npmRunAllPath = resolve(
  __dirname,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "npm-run-all.cmd" : "npm-run-all"
);

// Command and arguments
const args = ["--parallel", "--print-label", "--race", "serve_visual", "frtts"];

// Spawn process using local binary
const child = spawn(npmRunAllPath, args, {
  stdio: "inherit",
  shell: false, // false is safer when calling a direct binary
  cwd: __dirname,
});

child.on("exit", (code) => {
  process.exit(code);
});

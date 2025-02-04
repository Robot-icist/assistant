import { spawn, exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

/**
 * Runs an executable with the provided arguments and passes stdout/stderr data back to the callback.
 *
 * @param {string} executable - The path to the executable file.
 * @param {string[]} args - The arguments to pass to the executable.
 * @param {function} callback - The callback to handle output or errors.
 */
export function runExecutableWithArgs(executable, args, callback, rs = true) {
  console.log(executable, args);
  const process = spawn(executable, args);

  process.stdout.on("data", (data) => {
    if (callback) callback(null, data.toString());
  });

  process.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
    if (callback) callback(new Error(data.toString()), null);
  });

  process.on("error", (err) => {
    if (callback) callback(err, null);
    if (rs) runExecutableWithArgs(executable, args, callback);
  });

  process.on("close", (code) => {
    if (code !== 0) {
      if (callback)
        callback(new Error(`Process exited with code ${code}`), null);
    }
    if (rs) runExecutableWithArgs(executable, args, callback);
  });
}

// Function to launch PowerShell in admin mode and execute a script
export function runPowerShellAsAdmin(scriptPath) {
  // Ensure the script path is absolute
  const absoluteScriptPath = path.resolve(__dirname, scriptPath);

  // PowerShell command to elevate and run the script
  const command = `powershell.exe -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${absoluteScriptPath}\\"'-WindowStyle Hidden -Verb RunAs"`;

  // Execute the command
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error Powershell: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Stderr Powershell: ${stderr}`);
      return;
    }
    console.log(`Stdout Powershell: ${stdout}`);
  });
}

export default { runExecutableWithArgs, runPowerShellAsAdmin };

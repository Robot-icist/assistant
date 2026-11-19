import { execFile } from "child_process";
import { setSubdomain } from "./set-subdomain.js";

const tailscaleExecutable =
  process.env.TAILSCALE_BIN ||
  (process.platform === "win32" ? "tailscale.exe" : "tailscale");

const runTailscale = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      tailscaleExecutable,
      args,
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });

export const setupTailscaleServe = async () => {
  const identityOutput = await runTailscale(["whoami", "--json"]);
  const identity = JSON.parse(identityOutput);
  const machineName = identity.Node?.Name?.replace(/\.$/, "");

  if (!machineName) {
    throw new Error("Tailscale whoami did not return the machine DNS name.");
  }

  const hostname = setSubdomain(false, machineName);
  const services = [
    { httpsPort: 443, localPort: 1234 },
    // { httpsPort: 1234, localPort: 1234 },
    { httpsPort: 8443, localPort: 80 },
    { httpsPort: 10000, localPort: 10000 },
  ];

  for (const { httpsPort, localPort } of services) {
    await runTailscale([
      "serve",
      "--bg",
      `--https=${httpsPort}`,
      `http://127.0.0.1:${localPort}`,
    ]);
    console.log(
      `Tailscale Serve: https://${hostname}:${httpsPort} -> localhost:${localPort}`
    );
  }
};
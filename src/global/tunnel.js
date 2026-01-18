import { runExecutableWithArgs } from "./processRunner.js";
import ngrok from "@ngrok/ngrok";
import localtunnel from "localtunnel";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { Kill } from "../../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

export const pageKite = false;

export const subdomain = "small-rain";

const ngrokTunnel = () => {
  ngrok
    .connect({
      addr: 1234,
      authtoken: process.env.NGROK_API_KEY,
      domain: "probable-lab-settled.ngrok-free.app",
    })
    .then((listener) =>
      console.log(`Ingress established at: ${listener.url()}`)
    )
    .catch(console.log);
};

export const activeLocalTunnels = [];
let suppressLocalTunnelReopen = false;

const addActiveTunnel = (obj) => activeLocalTunnels.push(obj);
const removeActiveTunnel = (tunnel) => {
  const idx = activeLocalTunnels.findIndex((e) => e.tunnel === tunnel);
  if (idx >= 0) activeLocalTunnels.splice(idx, 1);
};

export const closeAllLocalTunnels = async () => {
  suppressLocalTunnelReopen = true;
  const copy = [...activeLocalTunnels];
  for (const entry of copy) {
    try { entry.clearReopenTimer?.(); } catch (e) { }
    try { entry.tunnel.close(); } catch (e) { }
  }
  activeLocalTunnels.length = 0;
  console.log("All local tunnels closed and cleared.");
};

/**
 * Restart a specific active local tunnel.
 * identifier can be:
 *  - a tunnel object reference (the object returned by localtunnel)
 *  - an object with { port, subdomain }
 *  - a port number
 * Returns a Promise that resolves to the new tunnel object when recreated, or rejects on timeout.
 */
export const restartLocalTunnel = async (identifier, { timeoutMs = 15000 } = {}) => {
  if (!identifier) return null;

  let entry;
  // tunnel reference passed directly
  if (typeof identifier === 'object' && identifier && identifier.tunnel) {
    entry = activeLocalTunnels.find((e) => e.tunnel === identifier.tunnel) || activeLocalTunnels.find((e) => e.tunnel === identifier);
  } else if (typeof identifier === 'object') {
    // match by port/subdomain
    entry = activeLocalTunnels.find((e) => {
      const portMatch = !identifier.port || e.port === identifier.port;
      const subdomainMatch = !identifier.subdomain || e.subdomain === identifier.subdomain;
      return portMatch && subdomainMatch;
    });
  } else if (typeof identifier === 'number') {
    entry = activeLocalTunnels.find((e) => e.port === identifier);
  }

  if (!entry) {
    console.log('No matching local tunnel to restart');
    return null;
  }

  const oldTunnel = entry.tunnel;
  try { entry.clearReopenTimer?.(); } catch (e) { }

  // trigger close; makeLocalTunnel's close handler will recreate it (unless reopen is suppressed)
  try {
    oldTunnel.close();
  } catch (e) {
    /* ignore */
  }

  // wait for a new tunnel with same port/subdomain to appear in activeLocalTunnels
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      const elapsed = Date.now() - start;
      const found = activeLocalTunnels.find((e) => e.port === entry.port && e.subdomain === entry.subdomain && e.tunnel !== oldTunnel);
      if (found) {
        clearInterval(iv);
        resolve(found.tunnel);
      } else if (elapsed >= timeoutMs) {
        clearInterval(iv);
        reject(new Error('Timeout waiting for tunnel to restart'));
      }
    }, 200);
  });
};

export const makeLocalTunnel = async (port = 80, subdomain = subdomain, periodicClose = false) => {
  const REOPEN_MS = parseInt(process.env.LOCALTUNNEL_REOPEN_MS, 10) || 1 * 60 * 1000; // default: 1 minute
  let tunnel;
  try {
    tunnel = await localtunnel({
      port: port,
      subdomain: subdomain,
    });
  } catch (err) {
    console.log("Failed to create local tunnel, retrying in 5s...", err);
    setTimeout(() => makeLocalTunnel(port, subdomain, periodicClose), 5000);
    return null;
  }

  // the assigned public url for your tunnel
  // i.e. https://abcdefgjhij.loca.lt
  tunnel.url;
  console.log(`Ingress established at: ${tunnel.url}`);

  // set a timer to periodically close the tunnel so it will reopen in the 'close' handler
  let reopenTimer = null;
  if (periodicClose) {
    reopenTimer = setTimeout(() => {
      console.log(`Periodic close (${REOPEN_MS}ms) of local tunnel to force reopen`);
      try { tunnel.close(); } catch (e) { /* ignore */ }
    }, REOPEN_MS);
  } else {
    console.log("Periodic close disabled for this tunnel");
  }

  const clearReopenTimer = () => {
    if (reopenTimer) {
      clearTimeout(reopenTimer);
      reopenTimer = null;
    }
  };

  // add to active list
  addActiveTunnel({ tunnel, port, subdomain, periodicClose, clearReopenTimer });

  tunnel.on("close", () => {
    // tunnels are closed
    clearReopenTimer();
    removeActiveTunnel(tunnel);
    console.log("closed local tunnel, retrying...");
    // small delay to avoid tight restart loops
    if (!suppressLocalTunnelReopen) {
      setTimeout(() => makeLocalTunnel(port, subdomain, periodicClose), 1000);
    }
  });

  tunnel.on("error", (err) => {
    clearReopenTimer();
    removeActiveTunnel(tunnel);
    console.log("Error in local tunnel, retrying...", err);
    if (!suppressLocalTunnelReopen) {
      setTimeout(() => makeLocalTunnel(port, subdomain, periodicClose), 1000);
    }
  });

  if(!tunnel.url.includes(subdomain)) {
    //Kill();
    clearReopenTimer();
    removeActiveTunnel(tunnel);
    try { tunnel.close(); } catch (e) { /* ignore */ }
    tunnel = null;
    return null;
  }
  return tunnel;
};

export const tunnel = async () => {
  if (pageKite) {
    runExecutableWithArgs(
      "python",
      [
        path.resolve(__dirname, "../python/pagekite.py"),
        "80",
        `ws-${subdomain}.pagekite.me`,
        "AND",
        "10000",
        `whisper-${subdomain}.pagekite.me`,
        "AND",
        "1234",
        `${subdomain}.pagekite.me`,
        // "AND",
        // "7860",
        // `xtts-${subdomain}.pagekite.me`,
        // "AND",
        // "7861",
        // `sadtalker-${subdomain}.pagekite.me`,
        // "+ip/92.184.112=ok",
      ],
      console.log
    );
  } else {
    await makeLocalTunnel(1234, `${subdomain}`);
    await makeLocalTunnel(80, `ws-${subdomain}`);
    await makeLocalTunnel(10000, `whisper-${subdomain}`, false);
  }
};

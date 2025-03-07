import { runExecutableWithArgs } from "./processRunner.js";
import ngrok from "@ngrok/ngrok";
import localtunnel from "localtunnel";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

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

const makeLocalTunnel = async (port = 80, subdomain = "personalassistant") => {
  const tunnel = await localtunnel({
    port: port,
    subdomain: subdomain,
  });

  // the assigned public url for your tunnel
  // i.e. https://abcdefgjhij.loca.lt
  tunnel.url;
  console.log(`Ingress established at: ${tunnel.url}`);
  tunnel.on("close", () => {
    // tunnels are closed
  });
};

const pageKite = true;

const subdomain = "personala";

export const tunnel = async () => {
  if (pageKite) {
    runExecutableWithArgs(
      "python2",
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
        // "+ip/92.184.112=ok",
      ],
      console.log
    );
  } else {
    await makeLocalTunnel(80, `ws${subdomain}`);
    await makeLocalTunnel(10000, `whisper${subdomain}`);
    await makeLocalTunnel(1234, `${subdomain}`);
  }
};

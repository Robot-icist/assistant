import express from "express";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { isIPAllowed } from "./IP.js";
import { getProviderNames, listModels } from "../llm/providers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const app = express();
const publicDir = resolve(__dirname, "../voice/visual");
const port = Number(process.env.WEB_PORT || 1234);

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  console.log(ip, ip.split(":").pop(), isIPAllowed(ip));
  isIPAllowed(ip) ? next() : res.sendStatus(403);
});
app.get("/api/models", async (req, res) => {
  const provider = req.query.provider || "ollama";
  if (!getProviderNames().includes(provider)) {
    return res.status(400).json({ error: `Unsupported LLM provider: ${provider}` });
  }

  try {
    res.json({ provider, models: await listModels(provider) });
  } catch (error) {
    console.error(`Failed to list ${provider} models:`, error);
    res.status(502).json({ error: error.message });
  }
});
app.use(express.static(publicDir));
app.listen(port, () => console.log(`Server running on port ${port}`));

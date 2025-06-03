import express from "express";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { isIPAllowed } from "./IP.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const app = express();
const publicDir = resolve(__dirname, "../voice/visual");
const port = 1234;

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  console.log(ip, ip.split(":").pop(), isIPAllowed(ip));
  isIPAllowed(ip) ? next() : res.sendStatus(403);
});
app.use(express.static(publicDir));
app.listen(port, () => console.log(`Server running on port ${port}`));

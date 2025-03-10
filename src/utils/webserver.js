import express from "express";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { isIPAllowed } from "./AllowedIPs.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const app = express();
const publicDir = resolve(__dirname, "../voice/visual");
const port = 1234;

app.use((req, res, next) => {
  console.log(req.ip, req.ip.split(":").pop(), isIPAllowed(req.ip));
  isIPAllowed(req.ip) ? next() : res.sendStatus(403);
});
app.use(express.static(publicDir));
app.listen(port, () => console.log(`Server running on port ${port}`));

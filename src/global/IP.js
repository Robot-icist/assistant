import dotenv from "dotenv"
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // get the name of the directory

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// console.log(__dirname, 'env', process.env);

let ips = process.env.ALLOWED_IPS;

export const AllowedIPs = ips.split(",");

export const normalizeIP = (ip) =>
  ip.startsWith("::ffff:") ? ip.substring(7) : ip; // Convert IPv4-mapped IPv6 to IPv4

export const isIPAllowed = (ip) => {
  ip = normalizeIP(ip); // Normalize incoming IP
  return AllowedIPs.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regex.test(ip);
    }
    return ip === pattern;
  });
};

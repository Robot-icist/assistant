import "dotenv/config";

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

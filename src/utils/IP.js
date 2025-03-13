export const AllowedIPs = [
  "127.0.0.1",
  "::1",
  "92.184.*.*",
  "109.210.78.69",
  "128.79.182.244",
  "176.149.91.118",
  "184.163.47.39",
];

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

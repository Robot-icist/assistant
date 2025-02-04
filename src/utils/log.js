export function LOG(...str) {
  if (process.env.DEBUG) console.log(...str);
}

// utils/time.js
function parseDuration(str) {
  const value = parseInt(str);
  if (str.endsWith('h')) return value * 60 * 60 * 1000;
  if (str.endsWith('d')) return value * 24 * 60 * 60 * 1000;
  return 60 * 60 * 1000; // default 1h
}

module.exports = { parseDuration };

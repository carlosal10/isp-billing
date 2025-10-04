// utils/heartbeats.js
const beats = new Map(); // jobName -> Date

function mark(jobName) {
  beats.set(String(jobName), new Date());
}

function getAll() {
  const out = {};
  for (const [k, v] of beats.entries()) out[k] = v;
  return out;
}

module.exports = { mark, getAll };


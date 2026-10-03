'use strict';
// High-confidence source gate. Never print matched credentials.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
];
let failures = 0;
for (const file of new Set(paths)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (patterns.some(pattern => pattern.test(line))) { console.error(`Possible credential: ${file}:${index + 1}`); failures++; }
  });
}
if (failures) process.exitCode = 1;
else console.log(`Secret pattern check passed (${new Set(paths).size} files; high-confidence patterns only).`);

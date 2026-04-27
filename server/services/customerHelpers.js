function isYes(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1" || normalized === "on";
}

function accountKeys(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return [];

  const keys = new Set();
  const push = (key) => {
    if (key) keys.add(key);
  };

  push(raw);
  push(raw.toUpperCase());
  push(raw.toLowerCase());

  const compact = raw.replace(/[^A-Za-z0-9]/g, "");
  if (compact && compact !== raw) {
    push(compact);
    push(compact.toUpperCase());
    push(compact.toLowerCase());
  }

  return Array.from(keys);
}

function sanitizeAliases(list, excludeValue = "") {
  const skip = String(excludeValue || "").trim();
  const out = [];
  const seen = new Set();

  for (const entry of Array.isArray(list) ? list : []) {
    const alias = String(entry || "").trim();
    if (!alias) continue;
    if (skip && alias === skip) continue;

    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);

    if (out.length >= 10) break;
  }

  return out;
}

module.exports = {
  isYes,
  accountKeys,
  sanitizeAliases,
};

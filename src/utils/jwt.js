// src/utils/jwt.js
export function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json || null;
  } catch {
    return null;
  }
}

export function getExpiry(token) {
  const p = decodeJwt(token);
  return p?.exp ? p.exp * 1000 : null; // ms
}

export function isExpired(token, skewMs = 10_000) {
  const expMs = getExpiry(token);
  if (!expMs) return false; // no exp -> treat as non-expiring (or handle as expired)
  return Date.now() + skewMs >= expMs;
}

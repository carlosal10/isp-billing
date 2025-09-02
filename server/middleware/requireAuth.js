// middleware/requireAuth.js
const jwt = require("jsonwebtoken");

/**
 * Verifies a Bearer JWT and attaches claims to req.user
 * - Skips CORS preflight (OPTIONS)
 * - Accepts "Authorization: Bearer <token>"
 * - Optional cookie fallback (AUTH_TOKEN) if you ever need it
 */
module.exports = function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return res.sendStatus(204);

  // 1) Bearer from header
  const hdr = req.headers.authorization || "";
  const [, tokenFromHeader] = hdr.split(" ");

  // 2) Optional cookie support (disabled by default)
  const tokenFromCookie = req.cookies?.AUTH_TOKEN;

  const token = tokenFromHeader || tokenFromCookie;
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  try {
    if (!process.env.JWT_SECRET) {
      // Surface a clear server config error
      console.error("JWT_SECRET is not set");
      return res.status(500).json({ ok: false, error: "Server misconfigured (JWT secret)" });
    }
    // Add small clock skew tolerance if desired: { clockTolerance: 5 }
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    req.user = claims;      // e.g., { sub, email, ispId, role, ... }
    req.authToken = token;  // optional: downstream debugging
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
};

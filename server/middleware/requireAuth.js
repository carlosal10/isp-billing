
const jwt = require("jsonwebtoken");

module.exports = function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const bearer = req.headers.authorization || "";
  const [, token] = bearer.split(" ");
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
};

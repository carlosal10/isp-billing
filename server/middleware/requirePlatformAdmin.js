'use strict';

const { verifyAccessToken } = require('../utils/jwt');

module.exports = function requirePlatformAdmin(req, res, next) {
  const hdr = req.headers.authorization || '';
  const [, tokenFromHeader] = hdr.split(' ');
  const tokenFromCookie = req.cookies?.AUTH_TOKEN || req.cookies?.at;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing token' });
  }

  try {
    const claims = verifyAccessToken(token);
    if (claims?.aud !== 'platform-admin') {
      return res.status(403).json({ ok: false, error: 'Platform admin access required' });
    }

    req.user = { ...claims, isPlatformAdmin: true };
    req.role = 'platform-admin';
    req.authToken = token;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
};

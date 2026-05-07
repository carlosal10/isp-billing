'use strict';

const { verifyAccessToken } = require('../utils/jwt');

module.exports = function requirePortalAuth(req, res, next) {
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const bearer = req.headers.authorization || '';
  const [, tokenFromHeader] = bearer.split(' ');
  const token = tokenFromHeader || req.cookies?.AUTH_TOKEN || req.cookies?.at;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing portal token' });
  }

  try {
    const claims = verifyAccessToken(token);
    if (claims?.aud !== 'customer-portal') {
      return res.status(401).json({ ok: false, error: 'Wrong token audience' });
    }
    if (!claims?.sub || !claims?.tenantId) {
      return res.status(401).json({ ok: false, error: 'Invalid portal token claims' });
    }
    req.user = claims;
    req.portalCustomerId = String(claims.sub);
    req.tenantId = String(claims.tenantId);
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired portal token' });
  }
};

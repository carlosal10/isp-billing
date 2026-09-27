'use strict';

const { readBearerToken } = require('./bearerToken');
const { verifyCustomerPortalAccessToken } = require('../utils/jwt');

module.exports = function requirePortalAuth(req, res, next) {
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const token = readBearerToken(req);

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing portal token' });
  }

  try {
    const claims = verifyCustomerPortalAccessToken(token);
    req.user = claims;
    req.authRealm = 'customer-portal';
    req.authToken = token;
    req.portalCustomerId = String(claims.sub);
    req.tenantId = String(claims.tenantId);
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired portal token' });
  }
};

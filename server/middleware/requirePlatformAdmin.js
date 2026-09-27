'use strict';

const { readBearerToken } = require('./bearerToken');
const { verifyPlatformAccessToken } = require('../utils/jwt');
const PlatformAdmin = require('../models/PlatformAdmin');

async function findPlatformAdmin(adminId) {
  return PlatformAdmin.findById(adminId)
    .select({ isActive: 1, isSuper: 1, sessionVersion: 1, revokedAt: 1 })
    .lean();
}

function createRequirePlatformAdmin({ adminLookup = findPlatformAdmin } = {}) {
  return async function requirePlatformAdmin(req, res, next) {
    const token = readBearerToken(req);

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing token' });
    }

    try {
      const claims = verifyPlatformAccessToken(token);
      const admin = await adminLookup(claims.sub);

      if (!admin || admin.isActive === false || admin.revokedAt) {
        return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
      }

      const currentVersion = Number(admin.sessionVersion || 0);
      if (
        Number(claims.sessionVersion || 0) !== currentVersion
      ) {
        return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
      }

      // Authorization-sensitive flags come from the current database record,
      // so demoting a super administrator takes effect immediately.
      req.user = {
        ...claims,
        isPlatformAdmin: true,
        isSuper: Boolean(admin.isSuper),
        sessionVersion: currentVersion,
      };
      req.role = 'platform-admin';
      req.authRealm = 'platform-admin';
      req.authToken = token;
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
  };
}

const requirePlatformAdmin = createRequirePlatformAdmin();

module.exports = requirePlatformAdmin;
module.exports.createRequirePlatformAdmin = createRequirePlatformAdmin;
module.exports.findPlatformAdmin = findPlatformAdmin;

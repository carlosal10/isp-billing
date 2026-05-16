'use strict';

const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Permitted-Cross-Domain-Policies': 'none',
});

function requestLooksSecure(req = {}) {
  return req.secure === true || String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function shouldApplyHsts(req = {}, env = process.env) {
  return env.NODE_ENV === 'production' || requestLooksSecure(req);
}

function setHeaderIfMissing(res, key, value) {
  if (typeof res.getHeader === 'function' && res.getHeader(key)) return;
  res.setHeader(key, value);
}

function applySecurityHeaders(req, res, options = {}) {
  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    setHeaderIfMissing(res, key, value);
  });

  if (shouldApplyHsts(req, options.env || process.env)) {
    setHeaderIfMissing(res, 'Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

function securityHeaders(options = {}) {
  return (req, res, next) => {
    applySecurityHeaders(req, res, options);
    next();
  };
}

module.exports = {
  BASE_SECURITY_HEADERS,
  applySecurityHeaders,
  requestLooksSecure,
  securityHeaders,
  shouldApplyHsts,
};

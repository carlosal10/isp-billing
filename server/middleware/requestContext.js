'use strict';

const crypto = require('crypto');

const REQUEST_ID_HEADER = 'X-Request-ID';
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

function sanitizeRequestId(value) {
  const text = String(value || '').trim();
  return REQUEST_ID_PATTERN.test(text) ? text : null;
}

function generateRequestId() {
  return `req_${crypto.randomBytes(12).toString('hex')}`;
}

function requestContext() {
  return (req, res, next) => {
    const incoming = sanitizeRequestId(req.headers?.['x-request-id']);
    const requestId = incoming || generateRequestId();
    req.id = requestId;
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  };
}

module.exports = {
  REQUEST_ID_HEADER,
  generateRequestId,
  requestContext,
  sanitizeRequestId,
};

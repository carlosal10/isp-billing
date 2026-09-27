'use strict';

function readBearerToken(req) {
  const header = String(req?.headers?.authorization || '').trim();
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match ? match[1] : null;
}

module.exports = { readBearerToken };

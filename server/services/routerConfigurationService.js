'use strict';
const Router = require('../models/MikrotikConnection');
const { decryptField } = require('../security/fieldEncryption');
async function loadRouterConfig(tenantId, selector = {}) {
  if (!tenantId) return null;
  let query = { tenant: tenantId };
  // An explicit selection must never fall back to a different router.
  if (selector.id) query._id = selector.id;
  else if (selector.name) query.name = String(selector.name).trim();
  else if (selector.host) { query.host = String(selector.host).trim(); if (selector.port) query.port = selector.port; }
  let record;
  try { record = await Router.findOne(query).sort({ primary: -1, _id: 1 }).lean(); }
  catch (error) { if (error.name === 'CastError') return null; throw error; }
  if (!record) return null;
  return { id: String(record._id), host: record.host, port: record.port || (record.tls ? 8729 : 8728),
    user: record.username, password: decryptField(record.password), tls: !!record.tls, timeout: record.timeout || 15000 };
}
module.exports = { loadRouterConfig };

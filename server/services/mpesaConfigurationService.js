'use strict';
const Config = require('../models/PaymentConfig');
const Legacy = require('../models/MpesaSettings');
const fields = ['businessName', 'environment', 'consumerKey', 'consumerSecret', 'payMethod', 'paybillShortcode', 'paybillPasskey', 'buyGoodsTill', 'buyGoodsPasskey'];
// Compatibility reads promote legacy settings once. All subsequent writes and
// reads use PaymentConfig; the legacy record remains intact for rollback.
async function getMpesaConfig(tenantId) {
  const ispId = String(tenantId);
  const existing = await Config.findOne({ ispId, provider: 'mpesa' });
  if (existing) return existing;
  const legacy = await Legacy.findOne({ ispId }).lean();
  if (!legacy) return null;
  const values = Object.fromEntries(fields.filter(key => legacy[key] != null).map(key => [key, legacy[key]]));
  try { return await Config.findOneAndUpdate({ ispId, provider: 'mpesa' }, { $setOnInsert: values }, { upsert: true, new: true, runValidators: true }); }
  catch (err) { if (err.code === 11000) return Config.findOne({ ispId, provider: 'mpesa' }); throw err; }
}
async function resolveMpesaShortcode(shortcode) {
  const code = String(shortcode || '').trim();
  if (!code) return null;
  const selector = { $or: [{ paybillShortcode: code }, { buyGoodsTill: code }] };
  for (const legacy of await Legacy.find(selector).select('ispId').lean()) {
    if (legacy.ispId) await getMpesaConfig(legacy.ispId);
  }
  const matches = await Config.find({ provider: 'mpesa', ...selector }).limit(2).lean();
  // A shared shortcode must never guess the tenant for a public callback.
  return matches.length === 1 ? matches[0] : null;
}
module.exports = { getMpesaConfig, resolveMpesaShortcode };

'use strict';
const { createHash } = require('node:crypto');
const Statement = require('../models/ProviderStatement');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const { financialTransaction } = require('./financialTransaction');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const cents = amount => Math.round(amount * 100);

// A normalized statement is a snapshot of gross successful receipts, before fees.
// Refunds are reviewed in the payment audit and are not silently netted from receipts.
function normalizeStatement(input) {
  if (!['mpesa', 'stripe', 'paypal'].includes(input.provider)) fail('Unsupported provider');
  const start = new Date(input.start), end = new Date(input.end);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || end - start > 93 * 86400000) fail('Choose a valid statement period of at most 93 days');
  if (!Array.isArray(input.rows) || input.rows.length > 2000) fail('A statement supports up to 2,000 rows');
  const rows = input.rows.map(row => {
    if (!row || typeof row !== 'object') fail('Each statement row must be an object');
    const reference = String(row.reference || '').trim(), currency = String(row.currency || '').trim().toUpperCase();
    const amount = Number(row.amount), occurredAt = new Date(row.occurredAt);
    if (!reference || reference.length > 160 || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || amount <= 0 || amount > 1e10 || Math.abs(amount * 100 - cents(amount)) > 0.0001) fail('Each row needs a reference, positive amount with at most two decimals, and currency');
    if (!Number.isFinite(+occurredAt) || occurredAt < start || occurredAt >= end) fail('All receipt timestamps must fall inside the selected period (end exclusive)');
    return { reference, currency, amount, occurredAt };
  });
  return { provider: input.provider, start, end, rows };
}

function compareStatement(statement, payments) {
  const provider = new Map(), internal = new Map(), totals = new Map();
  function add(map, key, row) { map.set(key, [...(map.get(key) || []), row]); }
  function total(currency, side, amount) {
    const row = totals.get(currency) || { currency, provider: 0, internal: 0 };
    row[side] += cents(amount); totals.set(currency, row);
  }
  for (const row of statement.rows) { add(provider, row.reference, row); total(row.currency, 'provider', row.amount); }
  for (const row of payments) { add(internal, row.transactionId || `unreferenced:${row._id}`, row); total(row.currency, 'internal', row.amount); }
  const rows = [...new Set([...provider.keys(), ...internal.keys()])].sort().map(reference => {
    const external = provider.get(reference) || [], local = internal.get(reference) || [];
    const status = external.length > 1 || local.length > 1 ? 'duplicate' : !local.length ? 'missing-payment' : !external.length ? 'missing-provider-receipt' :
      external[0].currency !== local[0].currency || cents(external[0].amount) !== cents(local[0].amount) ? 'mismatch' : 'matched';
    const key = hash([reference, status, external.map(r => [r.amount, r.currency]), local.map(r => [String(r._id), r.amount, r.currency])]);
    return { key, reference, status, external, payments: local, acknowledgement: statement.acknowledgements?.find(a => a.key === key) || null };
  });
  return { rows, unresolved: rows.filter(r => r.status !== 'matched' && !r.acknowledgement).length,
    totals: [...totals.values()].map(r => ({ currency: r.currency, provider: r.provider / 100, internal: r.internal / 100, difference: (r.provider - r.internal) / 100 })) };
}

async function importStatement({ tenantId, actor, ...input }) {
  const normalized = normalizeStatement(input), digest = hash(normalized);
  try { return await financialTransaction(async () => {
    const existing = await Statement.findOne({ tenantId, digest });
    if (existing) return existing;
    const statement = await Statement.create({ ...normalized, tenantId, digest, importedBy: actor });
    await AuditLog.create({ tenantId, actor, action: 'finance.statement.import', payload: { statementId: statement._id, provider: normalized.provider, count: normalized.rows.length, digest } });
    return statement;
  }); } catch (err) {
    if (err.code === 11000) { const existing = await Statement.findOne({ tenantId, digest }); if (existing) return existing; }
    throw err;
  }
}
async function getStatementReport(tenantId, id) {
  const statement = await Statement.findOne({ _id: id, tenantId }).lean();
  if (!statement) throw Object.assign(new Error('Statement not found'), { statusCode: 404 });
  const payments = await Payment.find({ tenantId, method: statement.provider, isDeleted: false,
    status: { $in: ['Success', 'Validated', 'Refunded', 'Reversed', 'Chargeback'] },
    $or: [{ validatedAt: { $gte: statement.start, $lt: statement.end } }, { validatedAt: null, createdAt: { $gte: statement.start, $lt: statement.end } }],
  }).select('_id transactionId amount currency status isFinanciallyApplied').limit(10001).lean();
  if (payments.length > 10000) fail('Too many payments; split the statement into shorter periods');
  return { ...statement, ...compareStatement(statement, payments) };
}
async function acknowledgeDiscrepancy({ tenantId, id, key, reason, actor }) {
  reason = String(reason || '').trim();
  if (reason.length < 5 || reason.length > 500) fail('A resolution reason of 5–500 characters is required');
  return financialTransaction(async () => {
    const report = await getStatementReport(tenantId, id), row = report.rows.find(r => r.key === key);
    if (!row || row.status === 'matched') fail('Discrepancy has changed; refresh the report');
    if (row.acknowledgement) return;
    await Statement.updateOne({ _id: id, tenantId }, { $push: { acknowledgements: { key, reason, actor, at: new Date() } } });
    await AuditLog.create({ tenantId, actor, action: 'finance.statement.acknowledge', payload: { statementId: id, key, reason, status: row.status } });
  });
}
module.exports = { normalizeStatement, compareStatement, importStatement, getStatementReport, acknowledgeDiscrepancy };

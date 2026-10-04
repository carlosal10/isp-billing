'use strict';
const Assignment = require('../models/NetworkAssignment');
const Cursor = require('../models/UsageCursor');
const Event = require('../models/UsageEvent');
const { financialTransaction } = require('./financialTransaction');
const manager = require('../utils/mikrotikConnectionManager');
function queueCounters(value) {
  const match = /^(\d{1,20})\/(\d{1,20})$/.exec(String(value));
  if (!match || match.slice(1).some(v => BigInt(v) > 18446744073709551615n)) throw new Error('Invalid queue byte counters');
  return { uploadBytes: BigInt(match[1]), downloadBytes: BigInt(match[2]) };
}
async function pollStaticUsage(a, send = (...args) => manager.sendCommand(...args), now = new Date()) {
  const name = 'billing-' + a._id;
  const rows = await send('/queue/simple/print', ['=stats=', '?name=' + name], { tenantId: String(a.tenantId), serverId: String(a.routerId), timeoutMs: 8000, retryCount: 0 });
  const row = rows.find(r => r.name === name);
  if (!row || String(row.target).replace('/32', '') !== a.ipAddress) throw new Error('Managed queue does not match subscriber');
  const counters = queueCounters(row.bytes);
  return financialTransaction(async () => {
    const filter = { tenantId: a.tenantId, assignmentId: a._id };
    let previous = await Cursor.findOne(filter);
    if (previous && previous.observedAt >= now) return { duplicate: true };
    const delta = key => !previous ? 0n : counters[key] < BigInt(previous[key]) ? counters[key] : counters[key] - BigInt(previous[key]);
    const reset = previous && (counters.uploadBytes < BigInt(previous.uploadBytes) || counters.downloadBytes < BigInt(previous.downloadBytes));
    await Event.create({ ...filter, routerId: a.routerId, customerId: a.customerId, sessionKey: 'queue:' + a._id, source: 'queue',
      occurredAt: now, uploadBytes: delta('uploadBytes').toString(), downloadBytes: delta('downloadBytes').toString(), counterReset: !!reset });
    if (!previous) previous = new Cursor(filter);
    previous.uploadBytes = counters.uploadBytes.toString(); previous.downloadBytes = counters.downloadBytes.toString(); previous.observedAt = now;
    await previous.save();
    return { reset: !!reset };
  });
}
async function pollAllStaticUsage() {
  let after, collected = 0, failed = 0;
  for (;;) {
    const filter = { accessType: 'static', status: { $ne: 'released' }, fupPolicyId: { $ne: null }, ...(after ? { _id: { $gt: after } } : {}) };
    const batch = await Assignment.find(filter).sort({ _id: 1 }).limit(100).lean();
    if (!batch.length) break;
    for (const a of batch) { try { await pollStaticUsage(a); collected++; } catch { failed++; } }
    after = batch.at(-1)._id;
  }
  return { collected, failed };
}
module.exports = { queueCounters, pollStaticUsage, pollAllStaticUsage };

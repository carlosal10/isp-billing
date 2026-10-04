'use strict';
const { z } = require('zod');
const { isIP } = require('node:net');
const Router = require('../models/MikrotikConnection');
const Session = require('../models/RadiusSession');
const { financialTransaction } = require('./financialTransaction');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const counter = z.string().regex(/^\d{1,20}$/).refine(v => BigInt(v) <= 18446744073709551615n);
const text = z.string().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/);
const schema = z.object({
  routerId: z.string().regex(/^[a-f0-9]{24}$/i), sessionKey: text, username: text,
  event: z.enum(['start', 'interim', 'stop']), occurredAt: z.string().datetime({ offset: true }),
  sessionSeconds: z.number().int().min(0).max(315360000),
  uploadBytes: counter, downloadBytes: counter,
  framedIp: z.string().refine(v => !!isIP(v)).optional(), terminateCause: z.string().max(128).optional(),
}).strict();
function normalizeAccounting(input, now = new Date()) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fail(400, 'Invalid accounting snapshot. Counters must be unsigned 64-bit decimal strings.');
  const row = parsed.data, time = new Date(row.occurredAt);
  if (time > new Date(now.getTime() + 300000) || time < new Date(now.getTime() - 90 * 86400000)) throw fail(400, 'Accounting timestamp must be within the last 90 days and no more than five minutes ahead.');
  return { ...row, occurredAt: time, uploadBytes: BigInt(row.uploadBytes).toString(), downloadBytes: BigInt(row.downloadBytes).toString() };
}
const larger = (a, b) => BigInt(a || '0') >= BigInt(b) ? (a || '0') : b;
async function ingestAccounting(tenantId, input, sourceKeyId) {
  const row = normalizeAccounting(input);
  if (!await Router.exists({ _id: row.routerId, tenant: tenantId })) throw fail(404, 'Router not found in the API key workspace.');
  const query = { tenantId, routerId: row.routerId, sessionKey: row.sessionKey };
  const apply = () => financialTransaction(async () => {
    let session = await Session.findOne(query);
    if (session && session.username !== row.username) throw fail(409, 'Session key is already assigned to another username.');
    if (!session) session = new Session({ ...query, username: row.username, status: 'active',
      startedAt: new Date(row.occurredAt.getTime() - row.sessionSeconds * 1000) });
    // Cumulative counters are max-merged, never summed. Duplicates and delayed
    // packets cannot inflate totals, reduce counters or reopen a stopped session.
    session.uploadBytes = larger(session.uploadBytes, row.uploadBytes);
    session.downloadBytes = larger(session.downloadBytes, row.downloadBytes);
    session.sessionSeconds = Math.max(session.sessionSeconds || 0, row.sessionSeconds);
    if (!session.lastEventAt || row.occurredAt >= session.lastEventAt) {
      session.lastEventAt = row.occurredAt;
      if (row.framedIp) session.framedIp = row.framedIp;
    }
    if (row.event === 'stop') {
      session.status = 'stopped';
      if (!session.stoppedAt || row.occurredAt > session.stoppedAt) {
        session.stoppedAt = row.occurredAt; session.terminateCause = row.terminateCause || null;
      }
    }
    session.sourceKeyId = sourceKeyId;
    session.expiresAt = new Date(session.lastEventAt.getTime() + 90 * 86400000);
    await session.save();
    return { id: String(session._id), status: session.status };
  });
  try { return await apply(); } catch (error) { if (error.code === 11000) return apply(); throw error; }
}
async function listSessions(tenantId, routerId, now = new Date()) {
  if (!await Router.exists({ _id: routerId, tenant: tenantId })) throw fail(404, 'Router not found.');
  const rows = await Session.find({ tenantId, routerId }).sort({ lastEventAt: -1 }).limit(100).select('-sourceKeyId -__v').lean();
  return rows.map(row => ({ ...row, status: row.status === 'active' && now - row.lastEventAt > 15 * 60000 ? 'stale' : row.status }));
}
module.exports = { normalizeAccounting, ingestAccounting, listSessions };

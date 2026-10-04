'use strict';
const { z } = require('zod');
const bytes = z.string().regex(/^[1-9]\d{0,19}$/).refine(v => BigInt(v) <= 18446744073709551615n);
const rate = z.string().regex(/^[1-9]\d{0,11}[kKM]?$/);
const policySchema = z.object({
  name: z.string().trim().min(1).max(100), includedBytes: bytes,
  period: z.enum(['monthly', 'rolling-30d']).default('monthly'),
  measurement: z.enum(['combined', 'upload', 'download']).default('combined'),
  warningPercent: z.number().int().min(1).max(1000).default(80),
  throttlePercent: z.number().int().min(1).max(1000).default(100),
  throttleDownload: rate.default('2M'), throttleUpload: rate.default('512K'),
  hardBlockPercent: z.number().int().min(1).max(10000).nullable().default(null),
  resetTimezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; } }).default('Africa/Nairobi'),
  enabled: z.boolean().default(true),
}).strict().refine(p => p.warningPercent <= p.throttlePercent, 'Warning must precede throttling')
  .refine(p => p.hardBlockPercent == null || p.hardBlockPercent >= p.throttlePercent, 'Blocking must follow throttling');
function parsePolicy(input) {
  const result = policySchema.safeParse(input);
  if (!result.success) throw Object.assign(new Error(result.error.issues.map(i => i.message).join('; ')), { statusCode: 400 });
  return result.data;
}
function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function midnight(year, month, timeZone) {
  const target = Date.UTC(year, month - 1, 1); let guess = target;
  for (let i = 0; i < 6; i++) {
    const p = localParts(new Date(guess), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - target;
    if (!offset) break;
    guess -= offset;
  }
  return new Date(guess);
}
function periodBounds(policy, now) {
  if (policy.period === 'rolling-30d') return { start: new Date(now.getTime() - 30 * 86400000), end: now };
  const p = localParts(now, policy.resetTimezone);
  return { start: midnight(p.year, p.month, policy.resetTimezone), end: midnight(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, policy.resetTimezone) };
}
function classify(policy, consumed) {
  const included = BigInt(policy.includedBytes), value = BigInt(consumed) * 100n;
  if (policy.hardBlockPercent != null && value >= included * BigInt(policy.hardBlockPercent)) return 'blocked';
  if (value >= included * BigInt(policy.throttlePercent)) return 'throttled';
  return value >= included * BigInt(policy.warningPercent) ? 'warned' : 'normal';
}
function routerRate(upload, download) { return `${upload}/${download}`; }
module.exports = { parsePolicy, periodBounds, classify, routerRate, policySchema };

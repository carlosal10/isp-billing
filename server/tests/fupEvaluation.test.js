'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parsePolicy, periodBounds, classify, routerRate } = require('../services/fupRules');
const policy = extra => parsePolicy({ name: 'Home', includedBytes: '100', ...extra });
test('FUP validates thresholds, rates, timezone and integer byte allowance', () => {
 for (const input of [{includedBytes:'0'},{includedBytes:'1.5'},{includedBytes:'18446744073709551616'},{warningPercent:101},{hardBlockPercent:99},{throttleUpload:'0'},{resetTimezone:'Nowhere/Unknown'}]) assert.throws(()=>policy(input));
 assert.equal(policy({includedBytes:'18446744073709551615'}).includedBytes, '18446744073709551615');
});
test('monthly periods honor Nairobi offset, leap years and DST', () => {
 let p=periodBounds(policy(),new Date('2026-09-30T21:01:00Z'));
 assert.equal(p.start.toISOString(),'2026-09-30T21:00:00.000Z');
 assert.equal(p.end.toISOString(),'2026-10-31T21:00:00.000Z');
 p=periodBounds(policy({resetTimezone:'America/New_York'}),new Date('2024-03-20Z'));
 assert.equal(p.start.toISOString(),'2024-03-01T05:00:00.000Z');
 assert.equal(p.end.toISOString(),'2024-04-01T04:00:00.000Z');
 p=periodBounds(policy({resetTimezone:'UTC'}),new Date('2024-02-20Z'));
 assert.equal((p.end-p.start)/86400000,29);
});
test('rolling period is exactly 30 days and threshold comparisons retain 64-bit precision', () => {
 const now=new Date('2026-10-15T12:31:00Z'), p=periodBounds(policy({period:'rolling-30d'}),now);
 assert.equal(+p.end-+p.start,30*86400000);
 const limit='18446744073709551615', v=policy({includedBytes:limit,hardBlockPercent:120});
 assert.equal(classify(v,BigInt(limit)-1n),'warned');
 assert.equal(classify(v,limit),'throttled');
 assert.equal(classify(policy({hardBlockPercent:120}),120n),'blocked');
 assert.equal(routerRate('512K','2M'),'512K/2M');
});

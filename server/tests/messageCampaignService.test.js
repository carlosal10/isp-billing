'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAudienceFilter,
  normalizeAudience,
  normalizeCampaignPayload,
  parseLimit,
  serializeCampaign,
} = require('../services/messageCampaignService');

test('message campaign limit parsing defaults invalid values and caps bulk sends', () => {
  assert.equal(parseLimit(undefined), 200);
  assert.equal(parseLimit('0'), 200);
  assert.equal(parseLimit('75.9'), 75);
  assert.equal(parseLimit('10000'), 500);
});

test('normalizeAudience keeps only supported filters and clamps limit', () => {
  const audience = normalizeAudience({
    status: 'active',
    connectionType: 'pppoe',
    query: 'fiber',
    customerIds: [' customer-1 ', '', null],
    limit: 999,
    ignored: true,
  });

  assert.equal(audience.status, 'active');
  assert.equal(audience.connectionType, 'pppoe');
  assert.equal(audience.query, 'fiber');
  assert.deepEqual(audience.customerIds, ['customer-1']);
  assert.equal(audience.limit, 500);
  assert.equal(Object.hasOwn(audience, 'ignored'), false);
});

test('normalizeCampaignPayload creates safe defaults for broadcast campaigns', () => {
  const payload = normalizeCampaignPayload({
    body: 'Hello {{name}}',
    audience: { status: 'active' },
  });

  assert.equal(payload.templateType, 'broadcast');
  assert.equal(payload.language, 'en');
  assert.equal(payload.category, 'broadcast');
  assert.equal(payload.includePaylink, false);
  assert.equal(payload.audience.status, 'active');
});

test('buildAudienceFilter scopes by tenant and supports search filters', () => {
  const filter = buildAudienceFilter('tenant-1', {
    status: 'active',
    connectionType: 'static',
    planId: '507f1f77bcf86cd799439011',
    query: 'Ada',
    customerIds: [],
  });

  assert.equal(filter.tenantId, 'tenant-1');
  assert.equal(filter.status, 'active');
  assert.equal(filter.connectionType, 'static');
  assert.equal(filter.plan, '507f1f77bcf86cd799439011');
  assert.equal(Array.isArray(filter.$or), true);
});

test('serializeCampaign returns campaign level audit counts without delivery internals', () => {
  const serialized = serializeCampaign({
    _id: 'campaign-1',
    name: 'Outage notice',
    status: 'partial',
    counts: { total: 10, sent: 8, skipped: 1, failed: 1 },
    deliveryIds: ['secret-delivery'],
  });

  assert.equal(serialized.id, 'campaign-1');
  assert.equal(serialized.counts.sent, 8);
  assert.equal(Object.hasOwn(serialized, 'deliveryIds'), false);
});

#!/usr/bin/env node
/**
 * Migration: Normalize Payment documents + enforce indexes
 * - Lowercase/trim method; normalize PayPal -> paypal
 * - Trim transactionId/accountNumber/phoneNumber
 * - Clamp negative amounts to 0
 * - Backfill soft-delete fields (isDeleted=false where missing)
 * - De-duplicate (tenantId, transactionId) conflicts (keeps oldest, soft-deletes others)
 * - Create partial unique index on (tenantId, transactionId) ignoring deleted/empty
 *
 * USAGE:
 *   DRY_RUN=1 MONGODB_URI="mongodb://localhost/db" node migrations/2025-09-28-normalize-payments.js
 *   MONGODB_URI="mongodb://localhost/db" node migrations/2025-09-28-normalize-payments.js
 *
 * SAFETY:
 * - DRY_RUN defaults to true. Set DRY_RUN=0 to actually write.
 */

'use strict';

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1/yourdb';
const DRY_RUN = String(process.env.DRY_RUN ?? '1') !== '0';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1000);

const METHOD_ENUM = new Set(['mpesa', 'manual', 'stripe', 'paypal']);
const STATUS_MAP = new Map([
  ['success', 'Success'],
  ['validated', 'Validated'],
  ['pending', 'Pending'],
  ['failed', 'Failed'],
  ['refunded', 'Refunded'],
  ['reversed', 'Reversed'],
]);

// Lightweight Payment schema (avoid model coupling issues)
const PaymentSchema = new mongoose.Schema(
  {
    tenantId: mongoose.Schema.Types.ObjectId,
    accountNumber: String,
    phoneNumber: String,
    customer: mongoose.Schema.Types.ObjectId,
    plan: mongoose.Schema.Types.ObjectId,
    amount: Number,
    transactionId: String,
    method: String,
    status: String,
    expiryDate: Date,

    validatedBy: String,
    validatedAt: Date,
    notes: String,

    editedAt: Date,
    editedBy: String,
    editLog: [{ at: Date, by: String, changes: Object }],

    isDeleted: Boolean,
    deletedAt: Date,
    deletedBy: String,
    deleteReason: String,
  },
  { timestamps: true, strict: false, versionKey: false, collection: 'payments' }
);

const Payment = mongoose.model('Payment_migration', PaymentSchema);

function clampNonNegative(n) {
  if (n == null) return n;
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return v < 0 ? 0 : v;
}

function normMethod(m) {
  if (m == null) return undefined;
  const s = String(m).toLowerCase().trim();
  if (s === 'paypal' || s === 'pay_pal' || s === 'payPal' || s === 'PayPal'.toLowerCase()) return 'paypal';
  return METHOD_ENUM.has(s) ? s : s; // keep unknowns (will not break; your model validates going forward)
}

function normStatus(st) {
  if (st == null) return undefined;
  const s = String(st).toLowerCase().trim();
  return STATUS_MAP.get(s) || st; // keep original if unusual
}

function tidyStr(v) {
  if (v == null) return v;
  const s = String(v).trim();
  return s;
}

async function createIndexes() {
  const coll = mongoose.connection.collection('payments');

  // Recent first per tenant
  await coll.createIndex({ tenantId: 1, createdAt: -1 }).catch(() => {});
  // Customer history per tenant
  await coll.createIndex({ tenantId: 1, customer: 1, createdAt: -1 }).catch(() => {});
  // Fast filter by status/method per tenant
  await coll.createIndex({ tenantId: 1, status: 1, method: 1, createdAt: -1 }).catch(() => {});
  // Soft delete visibility
  await coll.createIndex({ isDeleted: 1 }).catch(() => {});
  // Partial unique on (tenantId, transactionId) ignoring deleted & empty
  await coll.createIndex(
    { tenantId: 1, transactionId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        transactionId: { $type: 'string', $ne: '' },
        isDeleted: { $ne: true },
      },
      name: 'uniq_tx_per_tenant_active',
    }
  ).catch((e) => {
    if (e && e.codeName !== 'IndexOptionsConflict') throw e;
  });
}

async function normalizeAll() {
  const total = await Payment.countDocuments({});
  let processed = 0;
  let changed = 0;

  console.log(`🔎 Normalizing ${total} payment docs${DRY_RUN ? ' (dry-run)' : ''}…`);

  const cursor = Payment.find({}, null, { sort: { _id: 1 } }).cursor();

  const ops = [];
  for await (const doc of cursor) {
    processed++;

    const set = {};
    const unset = {};

    // normalize strings
    const accountNumber = tidyStr(doc.accountNumber);
    const phoneNumber = doc.phoneNumber != null ? tidyStr(doc.phoneNumber) : undefined;
    const transactionId = doc.transactionId != null ? tidyStr(doc.transactionId) : undefined;

    if (accountNumber !== doc.accountNumber) set.accountNumber = accountNumber;
    if (phoneNumber !== doc.phoneNumber && phoneNumber !== undefined) set.phoneNumber = phoneNumber;
    if (transactionId !== doc.transactionId && transactionId !== undefined) set.transactionId = transactionId;

    // normalize method/status
    const method = normMethod(doc.method);
    const status = normStatus(doc.status);
    if (method && method !== doc.method) set.method = method;
    if (status && status !== doc.status) set.status = status;

    // clamp amount
    const amount = clampNonNegative(doc.amount);
    if (amount !== doc.amount) set.amount = amount;

    // soft-delete defaults
    if (doc.isDeleted == null) set.isDeleted = false;

    // remove transactionId if empty string -> unset
    if (transactionId === '') unset.transactionId = '';

    if (Object.keys(set).length || Object.keys(unset).length) {
      changed++;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            ...(Object.keys(set).length ? { $set: set } : {}),
            ...(Object.keys(unset).length ? { $unset: unset } : {}),
          },
        },
      });
    }

    if (ops.length >= BATCH_SIZE) {
      if (!DRY_RUN) await Payment.bulkWrite(ops, { ordered: false });
      ops.length = 0;
      console.log(`  • normalized ${processed}/${total}…`);
    }
  }

  if (ops.length) {
    if (!DRY_RUN) await Payment.bulkWrite(ops, { ordered: false });
  }

  console.log(`✅ Normalization done. Processed: ${processed}, changed: ${changed}${DRY_RUN ? ' (simulated)' : ''}`);
  return { processed, changed };
}

async function dedupeByTenantAndTx() {
  // Group by tenantId+transactionId where not deleted and tx is non-empty string
  // Keep the oldest (createdAt asc) and soft-delete the rest.
  console.log(`🔎 Checking duplicate (tenantId, transactionId) …`);

  const coll = mongoose.connection.collection('payments');

  const dupGroups = await coll
    .aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          transactionId: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: { tenantId: '$tenantId', tx: '$transactionId' },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt' } },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (dupGroups.length === 0) {
    console.log('✅ No duplicates found.');
    return { groups: 0, removed: 0 };
  }

  let removed = 0;
  const ops = [];

  for (const g of dupGroups) {
    const docs = (g.docs || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keep = docs[0]?._id;
    const rest = docs.slice(1).map((d) => d._id);
    if (!keep || rest.length === 0) continue;

    removed += rest.length;
    ops.push({
      updateMany: {
        filter: { _id: { $in: rest } },
        update: {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: 'migration:dedupe',
            deleteReason: 'duplicate-transactionId-migration',
          },
        },
      },
    });

    if (ops.length >= 200) {
      if (!DRY_RUN) await coll.bulkWrite(ops, { ordered: false });
      ops.length = 0;
      console.log(`  • soft-deleted ${removed} duplicates so far…`);
    }
  }

  if (ops.length) {
    if (!DRY_RUN) await coll.bulkWrite(ops, { ordered: false });
  }

  console.log(`✅ Dedupe done. Groups: ${dupGroups.length}, soft-deleted: ${removed}${DRY_RUN ? ' (simulated)' : ''}`);
  return { groups: dupGroups.length, removed };
}

async function main() {
  console.log(`Connecting to ${MONGODB_URI} …`);
  await mongoose.connect(MONGODB_URI, { autoIndex: false });

  try {
    const norm = await normalizeAll();
    const dedupe = await dedupeByTenantAndTx();

    console.log('🧱 Ensuring indexes…');
    if (!DRY_RUN) await createIndexes();
    else console.log('  (skipped in dry-run)');

    console.log('— Summary —');
    console.table({
      normalizedDocs: norm.changed,
      duplicateGroups: dedupe.groups,
      softDeletedDuplicates: dedupe.removed,
      dryRun: DRY_RUN,
    });
  } catch (e) {
    console.error('❌ Migration error:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

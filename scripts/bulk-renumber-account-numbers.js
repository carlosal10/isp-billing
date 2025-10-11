#!/usr/bin/env node

// Bulk-regenerate tenant-bound account numbers while abbreviating address segments
// (first letters + numeric suffix) so final codes stay short and user-friendly.
const mongoose = require('mongoose');
const path = require('path');

const Customer = require(path.resolve(__dirname, '../server/models/customers'));
const Tenant = require(path.resolve(__dirname, '../server/models/Tenant'));
const { deriveAccountCode } = require(path.resolve(__dirname, '../server/utils/accountNumber'));

const MAX_LEN = 16;
const MAX_ATTEMPTS = 5;
const RANDOM_LENGTH = 10;
const RANDOM_TRIES = 50;
const RANDOM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function parseArgs(argv) {
  const options = { overridePrefix: null, dryRun: false };
  let tenantId = null;

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      if (!tenantId) tenantId = arg;
      continue;
    }
    const [rawKey, rawValue] = arg.slice(2).split('=');
    const key = rawKey.toLowerCase();
    const value = rawValue ?? '';
    switch (key) {
      case 'prefix':
        options.overridePrefix = value;
        break;
      case 'dry-run':
        options.dryRun = true;
        break;
      default:
        console.warn(`Unknown option --${rawKey}`);
    }
  }

  if (!tenantId) {
    throw new Error('Usage: node scripts/bulk-renumber-account-numbers.js <tenantId> [--prefix=ACC] [--dry-run]');
  }

  return { tenantId, options };
}

function randomCode(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)];
  }
  return out;
}

function buildCandidate(prefix, base, attempt) {
  const prefixPart = (prefix || '').trim();
  const combined = `${prefixPart}${base}` || 'CUST';

  if (attempt === 0) {
    return combined.slice(0, MAX_LEN) || combined;
  }

  const suffix = `-${attempt + 1}`;
  const truncated = combined.slice(0, Math.max(1, MAX_LEN - suffix.length));
  return `${truncated}${suffix}`;
}

function generateAccountNumber({ customer, prefix, used }) {
  const baseSource = customer.address || customer.name || customer.phone || customer._id;
  const baseCode = deriveAccountCode(baseSource);

  let candidate = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    candidate = buildCandidate(prefix, baseCode, attempt);
    if (!used.has(candidate)) {
      used.add(candidate);
      return { accountNumber: candidate, fromRandom: false };
    }
  }

  for (let i = 0; i < RANDOM_TRIES; i += 1) {
    candidate = randomCode(RANDOM_LENGTH);
    if (!used.has(candidate)) {
      used.add(candidate);
      return { accountNumber: candidate, fromRandom: true };
    }
  }

  throw new Error(`Unable to generate unique account number for customer ${customer._id}`);
}

async function run() {
  const { tenantId, options } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Missing MONGO_URI environment variable');
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected. Fetching customers for tenant ${tenantId}...`);

  const [tenant, customers] = await Promise.all([
    Tenant.findById(tenantId).lean(),
    Customer.find({ tenantId }).sort({ createdAt: 1, _id: 1 }).lean(),
  ]);

  if (!customers.length) {
    console.log('No customers found for tenant. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const prefix = options.overridePrefix !== null
    ? options.overridePrefix
    : (tenant?.accountPrefix || '').trim();

  console.log(`Using prefix: '${prefix || ''}' (override: ${options.overridePrefix !== null})`);

  const used = new Set();
  const updates = [];

  for (const customer of customers) {
    const { accountNumber: next, fromRandom } = generateAccountNumber({ customer, prefix, used });
    if (fromRandom) {
      console.warn(`Random fallback used for customer ${customer._id}.`);
    }
    if (next !== (customer.accountNumber || '')) {
      updates.push({ id: customer._id, accountNumber: next, old: customer.accountNumber });
    }
  }

  if (!updates.length) {
    console.log('All customers already conform to the prefix+address scheme.');
    await mongoose.disconnect();
    return;
  }

  if (options.dryRun) {
    console.log('Dry-run mode. The following updates would be applied:\n');
    for (const u of updates) {
      console.log(`${u.id}: ${u.old || '(blank)'} -> ${u.accountNumber}`);
    }
    console.log(`\nTotal pending updates: ${updates.length}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Applying ${updates.length} updates...`);
  for (const u of updates) {
    const oldAlias = typeof u.old === 'string' ? u.old.trim() : '';
    const updateDoc = {
      $set: { accountNumber: u.accountNumber },
    };
    if (oldAlias) {
      updateDoc.$addToSet = { accountAliases: oldAlias };
    }
    await Customer.updateOne(
      { _id: u.id, tenantId },
      updateDoc
    );
  }

  console.log('Done.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});

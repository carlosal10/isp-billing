#!/usr/bin/env node

/**
 * Backfill PPPoE account aliases so legacy usernames (old account numbers)
 * continue to resolve to customers in the dashboard.
 *
 * Usage:
 *   node scripts/backfill-pppoe-account-aliases.js <tenantId> [--dry-run]
 *   node scripts/backfill-pppoe-account-aliases.js --tenant=<tenantId> [--dry-run]
 *   node scripts/backfill-pppoe-account-aliases.js --all-tenants [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

const mongoose = require('mongoose');

const {
  sendCommand,
  setConfigLoader,
  shutdown: shutdownRouterPool,
} = require('../server/utils/mikrotikConnectionManager');

const MikroTikConnection = require('../server/models/MikrotikConnection');
const Customer = require('../server/models/customers');
const Tenant = require('../server/models/Tenant');

function parseArgs(argv) {
  const args = { tenantIds: [], dryRun: false, allTenants: false, help: false };
  for (const raw of argv) {
    const arg = String(raw || '').trim();
    if (!arg) continue;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--all-tenants') {
      args.allTenants = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--tenant=')) {
      args.tenantIds.push(arg.slice('--tenant='.length));
    } else if (arg.startsWith('--tenant-id=')) {
      args.tenantIds.push(arg.slice('--tenant-id='.length));
    } else if (arg.startsWith('--')) {
      console.warn(`Unknown option ${arg}`);
    } else {
      args.tenantIds.push(arg);
    }
  }

  if (args.help) {
    console.log(`
Usage:
  node scripts/backfill-pppoe-account-aliases.js <tenantId> [--dry-run]
  node scripts/backfill-pppoe-account-aliases.js --tenant=<tenantId> [--dry-run]
  node scripts/backfill-pppoe-account-aliases.js --all-tenants [--dry-run]

This script inspects PPP secrets on the configured MikroTik router(s) and
stores legacy usernames in Customer.accountAliases so the dashboard can map
sessions created before account renumbering.
`);
    process.exit(0);
  }

  if (!args.allTenants && args.tenantIds.length === 0) {
    throw new Error('Provide a tenant id or --all-tenants. Use --help for usage.');
  }

  // Deduplicate tenant ids while preserving order
  args.tenantIds = Array.from(new Set(args.tenantIds.map((id) => String(id || '').trim()).filter(Boolean)));
  return args;
}

function sanitizeAliases(list, excludeValue = '') {
  const skip = String(excludeValue || '').trim();
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const alias = String(entry || '').trim();
    if (!alias) continue;
    if (skip && alias === skip) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 10) break;
  }
  return out;
}

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

setConfigLoader(async (tenantId, selector = {}) => {
  let rec = null;
  if (selector?.id) {
    rec = await MikroTikConnection.findOne({ _id: selector.id, tenant: tenantId }).lean();
  }
  if (!rec && selector?.name) {
    rec = await MikroTikConnection.findOne({ tenant: tenantId, name: selector.name }).lean();
  }
  if (!rec && selector?.host) {
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      host: selector.host,
      port: selector.port || { $exists: true },
    }).lean();
  }
  if (!rec) {
    rec = await MikroTikConnection.findOne({ tenant: tenantId, primary: true }).lean();
  }
  if (!rec) {
    rec = await MikroTikConnection.findOne({ tenant: tenantId }).lean();
  }
  if (!rec) return undefined;
  return {
    host: rec.host,
    port: rec.port || (rec.tls ? 8729 : 8728),
    user: rec.username,
    password: rec.password,
    tls: !!rec.tls,
    timeout: 15000,
  };
});

async function resolveTenantIds({ tenantIds, allTenants }) {
  if (allTenants) {
    const all = await Tenant.find({}).select('_id').lean();
    return all.map((t) => t._id.toString());
  }
  if (!tenantIds.length) return [];
  // Validate requested tenant ids
  const found = await Tenant.find({ _id: { $in: tenantIds } }).select('_id').lean();
  const foundSet = new Set(found.map((t) => t._id.toString()));
  const missing = tenantIds.filter((id) => !foundSet.has(String(id)));
  if (missing.length) {
    throw new Error(`Tenant(s) not found: ${missing.join(', ')}`);
  }
  return tenantIds.map((id) => String(id));
}

async function loadSecrets(tenantId) {
  try {
    const rows = await sendCommand('/ppp/secret/print', [], { tenantId, timeoutMs: 15000 });
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    throw new Error(`Failed to load PPP secrets: ${err?.message || err}`);
  }
}

function buildSecretIndexes(secrets) {
  const byName = new Map();
  const byComment = new Map();

  for (const raw of secrets) {
    const username = String(raw?.name || raw?.user || raw?.username || '').trim();
    if (!username) continue;
    byName.set(username, raw);

    const commentRaw = String(raw?.comment || raw?.['comment'] || '').trim();
    if (commentRaw) {
      let commentValue = commentRaw;
      const prefix = 'customer:';
      if (commentValue.toLowerCase().startsWith(prefix)) {
        commentValue = commentValue.slice(prefix.length).trim();
      }
      const key = commentValue.toLowerCase();
      if (key) {
        if (!byComment.has(key)) byComment.set(key, []);
        byComment.get(key).push({ username, raw });
      }
    }
  }

  return { byName, byComment };
}

async function processTenant(tenantId, { dryRun }) {
  console.log(`\nTenant ${tenantId}:`);
  const routerCount = await MikroTikConnection.countDocuments({ tenant: tenantId });
  if (!routerCount) {
    console.log('  No MikroTik connection configured. Skipping.');
    return;
  }

  const customers = await Customer.find({
    tenantId,
    connectionType: 'pppoe',
  })
    .select('_id accountNumber name accountAliases')
    .lean();

  if (!customers.length) {
    console.log('  No PPPoE customers found. Skipping.');
    return;
  }

  let secrets = [];
  try {
    secrets = await loadSecrets(tenantId);
  } catch (err) {
    console.warn(`  ${err.message}`);
    return;
  }

  if (!secrets.length) {
    console.log('  Router returned no PPP secrets. Skipping.');
    return;
  }

  const { byName, byComment } = buildSecretIndexes(secrets);

  let updated = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const customer of customers) {
    const accountNumber = String(customer.accountNumber || '').trim();
    const existingAliases = sanitizeAliases(customer.accountAliases, accountNumber);
    const aliasSet = new Set(existingAliases);

    // If router already uses the new account number, nothing to do.
    if (accountNumber && byName.has(accountNumber)) {
      continue;
    }

    const candidateKeys = new Set();
    if (customer.name) candidateKeys.add(normalize(customer.name));
    if (accountNumber) candidateKeys.add(normalize(accountNumber));
    for (const alias of existingAliases) {
      candidateKeys.add(normalize(alias));
    }

    const matches = new Set();
    for (const key of candidateKeys) {
      if (!key) continue;
      const rows = byComment.get(key);
      if (!rows || !rows.length) continue;
      for (const row of rows) {
        const user = String(row?.username || '').trim();
        if (user && user !== accountNumber && !aliasSet.has(user)) {
          matches.add(user);
        }
      }
    }

    if (!matches.size) {
      unmatched += 1;
      continue;
    }

    if (matches.size > 1) {
      ambiguous += 1;
      console.warn(
        `  Ambiguous mapping for customer ${accountNumber || customer._id}: possible usernames ${Array.from(
          matches,
        ).join(', ')}`
      );
      continue;
    }

    const [alias] = Array.from(matches);
    aliasSet.add(alias);
    const nextAliases = Array.from(aliasSet).slice(0, 10);

    if (dryRun) {
      console.log(`  [dry-run] would add alias '${alias}' for customer ${accountNumber || customer._id}`);
    } else {
      await Customer.updateOne(
        { _id: customer._id },
        { $set: { accountAliases: nextAliases } }
      );
      console.log(`  Added alias '${alias}' for customer ${accountNumber || customer._id}`);
    }
    updated += 1;
  }

  console.log(
    `  Summary: updated=${updated}, unmatched=${unmatched}, ambiguous=${ambiguous}`,
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  try {
    const tenantIds = await resolveTenantIds(args);
    if (!tenantIds.length) {
      console.log('No tenants to process.');
      return;
    }
    for (const tenantId of tenantIds) {
      await processTenant(tenantId, { dryRun: args.dryRun });
    }
  } finally {
    await shutdownRouterPool().catch(() => {});
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});


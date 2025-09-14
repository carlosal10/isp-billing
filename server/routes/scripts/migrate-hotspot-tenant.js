// server/scripts/migrate-hotspot-tenant.js
// Backfill tenantId into hotspot-related collections

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const HotspotPlan = require('../models/HotspotPlan');
const HotspotAccess = require('../models/HotspotAccess');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');

function parseArgs(argv) {
  const args = { dryRun: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant-id') args.tenantId = argv[++i];
    else if (a === '--tenant-name') args.tenantName = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force-reassign') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function resolveTenantId({ tenantId, tenantName }) {
  if (tenantId) return tenantId;
  if (!tenantName) throw new Error('Provide --tenant-id or --tenant-name');
  const t = await Tenant.findOne({ name: tenantName }).lean();
  if (!t) throw new Error(`No tenant found with name: ${tenantName}`);
  return String(t._id);
}

async function update(Model, filter, setFields, { dryRun, label }) {
  const total = await Model.countDocuments({});
  const toUpdate = await Model.countDocuments(filter);
  console.log(`\n${label}: total=${total}, toUpdate=${toUpdate}`);
  if (toUpdate === 0) return;
  if (dryRun) {
    console.log('  dry-run: no changes written');
    return;
  }
  const res = await Model.updateMany(filter, { $set: setFields });
  console.log(`  updated: matched=${res.matchedCount ?? res.n}, modified=${res.modifiedCount ?? res.nModified}`);
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`\nUsage:\n  node server/scripts/migrate-hotspot-tenant.js --tenant-id <id> [--dry-run] [--force-reassign]\n  node server/scripts/migrate-hotspot-tenant.js --tenant-name "Acme ISP" [--dry-run] [--force-reassign]\n`);
    process.exit(0);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  const tenantId = await resolveTenantId(args);
  console.log('Target tenant:', tenantId);

  const filter = args.force ? {} : { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };

  await update(HotspotPlan, filter, { tenantId }, { dryRun: args.dryRun, label: 'HotspotPlan' });
  await update(HotspotAccess, filter, { tenantId }, { dryRun: args.dryRun, label: 'HotspotAccess' });
  await update(RegisteredHotspotUser, filter, { tenantId }, { dryRun: args.dryRun, label: 'RegisteredHotspotUser' });

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});


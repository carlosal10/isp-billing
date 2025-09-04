// server/scripts/migrate-tenant-backfill.js
// Attach legacy records to a tenant so they appear in the multi-tenant UI

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Tenant = require('../models/Tenant');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');

// Optional configs that historically keyed by `ispId` string
let PaymentConfig;
try { PaymentConfig = require('../models/PaymentConfig'); } catch {}

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

async function updateCollection(Model, filterMissing, setFields, { dryRun, label }) {
  const total = await Model.countDocuments({});
  const missing = await Model.countDocuments(filterMissing);
  console.log(`\n${label}: total=${total}, toUpdate=${missing}`);
  if (missing === 0) return { matched: 0, modified: 0 };
  if (dryRun) {
    console.log('  dry-run: no changes written');
    return { matched: missing, modified: 0 };
  }
  const res = await Model.updateMany(filterMissing, { $set: setFields });
  console.log(`  updated: matched=${res.matchedCount ?? res.n}, modified=${res.modifiedCount ?? res.nModified}`);
  return { matched: res.matchedCount ?? res.n, modified: res.modifiedCount ?? res.nModified };
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`\nUsage:\n  node server/scripts/migrate-tenant-backfill.js --tenant-id <id> [--dry-run] [--force-reassign]\n  node server/scripts/migrate-tenant-backfill.js --tenant-name "Acme ISP" [--dry-run] [--force-reassign]\n\nNotes:\n  - Without --force-reassign, only documents missing tenantId are updated.\n  - With --force-reassign, all documents are reassigned to the tenant. Use carefully.\n`);
    process.exit(0);
  }

  const mongo = process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGO_URI is not set');
  await mongoose.connect(mongo, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  const tenantId = await resolveTenantId(args);
  console.log('Target tenant:', tenantId);

  const filterMissing = args.force ? {} : { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] };

  // Customers
  await updateCollection(
    Customer,
    filterMissing,
    { tenantId },
    { dryRun: args.dryRun, label: 'Customer' }
  );

  // Plans
  await updateCollection(
    Plan,
    filterMissing,
    { tenantId },
    { dryRun: args.dryRun, label: 'Plan' }
  );

  // Invoices
  await updateCollection(
    Invoice,
    filterMissing,
    { tenantId },
    { dryRun: args.dryRun, label: 'Invoice' }
  );

  // Payments
  await updateCollection(
    Payment,
    filterMissing,
    { tenantId },
    { dryRun: args.dryRun, label: 'Payment' }
  );

  // Optional: align PaymentConfig.ispId to this tenant
  if (PaymentConfig) {
    const filterCfg = args.force ? {} : { $or: [{ ispId: { $exists: false } }, { ispId: null }, { ispId: '' }] };
    const total = await PaymentConfig.countDocuments({});
    const toUpdate = await PaymentConfig.countDocuments(filterCfg);
    console.log(`\nPaymentConfig: total=${total}, toUpdate=${toUpdate}`);
    if (!args.dryRun && toUpdate > 0) {
      const res = await PaymentConfig.updateMany(filterCfg, { $set: { ispId: String(tenantId) } });
      console.log(`  updated: matched=${res.matchedCount ?? res.n}, modified=${res.modifiedCount ?? res.nModified}`);
    } else {
      console.log('  dry-run or nothing to update');
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

'use strict';

const fs = require('fs');
const path = require('path');
const { scheduleJob } = require('../utils/scheduler');
const Customer = require('../models/customers');
const Payment = require('../models/Payment');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

async function exportTenant(tenantId, baseDir) {
  const dir = path.join(baseDir, String(tenantId));
  ensureDir(dir);
  const customers = await Customer.find({ tenantId }).lean();
  const payments = await Payment.find({ tenantId }).lean();
  fs.writeFileSync(path.join(dir, 'customers.json'), JSON.stringify(customers, null, 2));
  fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify(payments, null, 2));
  return { customers: customers.length, payments: payments.length };
}

scheduleJob({ name: 'nightlyExport', cronExpr: '30 2 * * *', task: async () => {
  const day = new Date();
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  const baseDir = path.resolve(__dirname, `../../exports/${yyyy}-${mm}-${dd}`);
  ensureDir(baseDir);
  // Distinct tenants from customers collection
  const tenants = await Customer.distinct('tenantId');
  let totalC = 0, totalP = 0;
  for (const t of tenants) {
    const stats = await exportTenant(t, baseDir);
    totalC += stats.customers;
    totalP += stats.payments;
  }
  return { tenants: tenants.length, customers: totalC, payments: totalP, dir: baseDir };
}});

console.log('Nightly export job scheduled (02:30).');


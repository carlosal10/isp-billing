'use strict';
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Ledger = require('../models/BillingLedgerEntry');
const Events = require('../models/PaymentGatewayEvent');
const Credit = require('../models/CreditNote');
const AccessOutbox = require('../models/AccessOutbox');
async function getReconciliation(tenantId) {
  const tenant = new mongoose.Types.ObjectId(String(tenantId));
  const settledUnapplied = await Payment.find({ tenantId: tenant, status: { $in: ['Success', 'Validated'] }, isDeleted: false, isFinanciallyApplied: false })
    .select('accountNumber amount currency transactionId status createdAt').sort({ createdAt: 1 }).limit(100).lean();
  const balances = await Ledger.aggregate([{ $match: { tenantId: tenant } }, { $group: {
    _id: '$currency', debit: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] } },
    credit: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] } },
  } }]);
  const unmatchedEvents = await Events.countDocuments({ tenantId: tenant, eventStatus: { $in: ['unmatched', 'failed', 'rejected'] } });
  const credits = await Credit.aggregate([{ $match: { tenantId: tenant, status: { $in: ['open', 'partially_applied'] } } },
    { $group: { _id: '$currency', amount: { $sum: '$remainingAmount' } } }]);
  const accessJobs = await AccessOutbox.find({ tenantId: tenant, status: { $ne: 'complete' } })
    .populate('customerId', 'name accountNumber').sort({ updatedAt: -1 }).limit(100).lean();
  return { settledUnapplied, unmatchedEvents, credits, accessJobs,
    ledger: balances.map(row => ({ currency: row._id, debit: row.debit, credit: row.credit, difference: Math.round((row.debit - row.credit) * 100) / 100 })),
    generatedAt: new Date(), limit: 100 };
}
module.exports = { getReconciliation };

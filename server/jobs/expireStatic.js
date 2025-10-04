// server/jobs/expireStatic.js
const { scheduleJob } = require('../utils/scheduler');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const { disableCustomerQueue } = require('../utils/mikrotikBandwidthManager');
scheduleJob({ name: 'expireStatic', cronExpr: '*/10 * * * *', task: async () => {
  const now = new Date();
  // group latest success per customer
  const latest = await Payment.aggregate([
    { $match: { status: 'Success', expiryDate: { $ne: null } } },
    { $sort: { customer: 1, expiryDate: -1 } },
    { $group: { _id: '$customer', expiryDate: { $first: '$expiryDate' }, tenantId: { $first: '$tenantId' } } },
    { $match: { expiryDate: { $lt: now } } },
  ]);
  for (const row of latest) {
    const customer = await Customer.findOne({ _id: row._id, tenantId: row.tenantId, connectionType: 'static' });
    if (!customer) continue;
    await Customer.updateOne({ _id: customer._id }, { $set: { status: 'inactive', updatedAt: new Date() } });
    await disableCustomerQueue(customer).catch(() => {});
  }
  return { expired: latest.length };
}});

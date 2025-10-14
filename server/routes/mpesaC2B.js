const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');
const MpesaSettings = require('../models/MpesaSettings');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { applyCustomerQueue, enableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[3];
    if (u === 'day') return n;
    if (u === 'week') return n * 7;
    if (u === 'month') return n * 30;
    if (u === 'year') return n * 365;
  }
  if (s === 'monthly' || s === 'month') return 30;
  if (s === 'weekly' || s === 'week') return 7;
  if (s === 'yearly' || s === 'annual' || s === 'year') return 365;
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

function parseMpesaTimestamp(ts) {
  if (!ts) return new Date();
  const s = String(ts).trim();
  if (!/^\d{14}$/.test(s)) return new Date();
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6)) - 1;
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  const minute = Number(s.slice(10, 12));
  const second = Number(s.slice(12, 14));
  return new Date(Date.UTC(year, month, day, hour - 3, minute, second));
}

async function resolveConfig(shortcode) {
  if (!shortcode) return null;
  const code = String(shortcode).trim();
  if (!code) return null;

  const config = await PaymentConfig.findOne({
    provider: 'mpesa',
    $or: [{ paybillShortcode: code }, { buyGoodsTill: code }],
  }).lean();
  if (config) return config;

  const settings = await MpesaSettings.findOne({
    $or: [{ paybillShortcode: code }, { buyGoodsTill: code }],
  }).lean();
  if (!settings) return null;

  return {
    provider: 'mpesa',
    ispId: settings.ispId || null,
    businessName: settings.businessName || null,
    payMethod:
      settings.payMethod ||
      (settings.buyGoodsTill ? 'buygoods' : 'paybill'),
    environment: settings.environment || 'sandbox',
    paybillShortcode: settings.paybillShortcode || null,
    buyGoodsTill: settings.buyGoodsTill || null,
  };
}

function normalizeMsisdn(msisdn) {
  if (!msisdn) return null;
  const raw = String(msisdn).replace(/\D/g, '');
  if (/^0?7\d{8}$/.test(raw)) return `254${raw.slice(-9)}`;
  if (/^2547\d{8}$/.test(raw)) return raw;
  if (/^\+?2547\d{8}$/.test(raw)) return raw.replace('+', '');
  return null;
}

router.post('/validation', async (req, res) => {
  const { BusinessShortCode, BillRefNumber } = req.body || {};
  const context = {
    shortcode: BusinessShortCode || null,
    account: BillRefNumber || null,
  };
  try {
    const config = await resolveConfig(BusinessShortCode);
    if (!config) {
      console.warn('[mpesa:c2b:validation] rejected - shortcode not registered', context);
      return res.json({ ResultCode: 1, ResultDesc: 'Shortcode not registered' });
    }
    if (!BillRefNumber) {
      console.warn('[mpesa:c2b:validation] rejected - missing account reference', {
        ...context,
        tenantId: config.ispId ? config.ispId.toString() : null,
      });
      return res.json({ ResultCode: 1, ResultDesc: 'Missing account reference' });
    }
    const accountRef = String(BillRefNumber).trim();
    let customer = null;
    if (config.ispId) {
      customer = await Customer.findOne({
        tenantId: config.ispId,
        accountNumber: accountRef,
      }).lean();
    }
    if (!customer) {
      customer = await Customer.findOne({ accountNumber: accountRef }).lean();
    }
    if (!customer) {
      console.warn('[mpesa:c2b:validation] rejected - account not found', {
        ...context,
        tenantId: config.ispId ? String(config.ispId) : null,
      });
      return res.json({ ResultCode: 1, ResultDesc: 'Account not found' });
    }
    if (customer?.tenantId) context.tenantId = customer.tenantId.toString();
    console.log('[mpesa:c2b:validation] accepted', {
      ...context,
      customerId: customer._id?.toString?.() || customer._id,
    });
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[mpesa:c2b:validation] error', {
      ...context,
      error: err?.message || err,
    });
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

router.post('/confirmation', async (req, res) => {
  const payload = req.body || {};
  const {
    TransactionType,
    TransID,
    TransTime,
    TransAmount,
    BusinessShortCode,
    BillRefNumber,
    InvoiceNumber,
    OrgAccountBalance,
    ThirdPartyTransID,
    MSISDN,
    FirstName,
    MiddleName,
    LastName,
  } = payload;

  try {
    const config = await resolveConfig(BusinessShortCode);
    const context = {
      transId: TransID || null,
      shortcode: BusinessShortCode || null,
      account: BillRefNumber || null,
      tenantId: config?.ispId ? config.ispId.toString() : null,
    };
    if (!config) {
      console.warn('[mpesa:c2b] unknown shortcode', context);
      return res.json({ ResultCode: 1, ResultDesc: 'Shortcode not registered' });
    }

    const accountRef = String(BillRefNumber || '').trim();
    const amount = Number(TransAmount);
    const msisdn = normalizeMsisdn(MSISDN);

    if (!accountRef) {
      console.warn('[mpesa:c2b] missing bill reference', context);
      return res.json({ ResultCode: 1, ResultDesc: 'Missing account reference' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn('[mpesa:c2b] invalid amount', { ...context, amount });
      return res.json({ ResultCode: 1, ResultDesc: 'Invalid amount' });
    }

    let customer = null;
    if (config.ispId) {
      customer = await Customer.findOne({
        tenantId: config.ispId,
        accountNumber: accountRef,
      });
    }
    if (!customer) {
      customer = await Customer.findOne({ accountNumber: accountRef });
    }

    if (!customer) {
      console.warn('[mpesa:c2b] customer not found', {
        ...context,
        accountRef,
      });
      return res.json({ ResultCode: 1, ResultDesc: 'Account not found' });
    }
    if (customer?.tenantId) context.tenantId = customer.tenantId.toString();

    const existing = await Payment.findOne({
      tenantId: customer.tenantId,
      transactionId: TransID,
      method: 'mpesa',
    }).lean();
    if (existing) {
      console.info('[mpesa:c2b] duplicate transaction', {
        ...context,
        paymentId: existing._id?.toString?.() || existing._id,
      });
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const planId = customer.plan;
    if (!planId) {
      console.warn('[mpesa:c2b] customer has no plan', {
        ...context,
        customerId: customer._id?.toString?.() || customer._id,
        accountRef,
      });
      return res.json({ ResultCode: 1, ResultDesc: 'Customer missing plan' });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      console.warn('[mpesa:c2b] plan not found', {
        ...context,
        planId: planId?.toString?.() || planId,
        customerId: customer._id?.toString?.() || customer._id,
      });
      return res.json({ ResultCode: 1, ResultDesc: 'Plan not found' });
    }

    const validatedAt = parseMpesaTimestamp(TransTime) || new Date();
    const payment = new Payment({
      tenantId: customer.tenantId,
      customer: customer._id,
      plan: plan._id,
      accountNumber: customer.accountNumber,
      phoneNumber: msisdn || null,
      amount,
      transactionId: TransID,
      method: 'mpesa',
      status: 'Success',
      validatedAt,
      validatedBy: 'mpesa-c2b',
      notes: `C2B ${TransactionType || ''}`.trim(),
      merchantRequestId: ThirdPartyTransID || null,
      checkoutRequestId: InvoiceNumber || null,
    });

    const days = plan.durationDays ?? parseDurationToDays(plan.duration);
    if (Number.isFinite(days) && days > 0) {
      const anchor = customer.expiryDate && new Date(customer.expiryDate) > new Date()
        ? new Date(customer.expiryDate)
        : new Date();
      const expiry = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
      payment.expiryDate = expiry;
      customer.expiryDate = expiry;
    }

    customer.status = 'active';
    if (FirstName || MiddleName || LastName) {
      const nameParts = [FirstName, MiddleName, LastName].filter(Boolean);
      if (!customer.name && nameParts.length) {
        customer.name = nameParts.join(' ');
      }
    }
    if (msisdn && !customer.phone) customer.phone = `+${msisdn}`;

    await payment.save();
    await customer.save().catch(() => {});

    try {
      const reconnectCtx = {
        tenantId: customer.tenantId?.toString?.() || customer.tenantId,
        account: customer.accountNumber,
        connectionType: customer.connectionType || 'unknown',
        paymentId: payment._id?.toString?.() || payment._id,
      };
      if (customer.connectionType === 'static') {
        await enableCustomerQueue(customer, plan);
        console.log('[mpesa:c2b] queue re-enabled', {
          ...reconnectCtx,
          action: 'enable-static',
        });
      } else {
        await applyCustomerQueue(customer, plan);
        console.log('[mpesa:c2b] queue reapplied', {
          ...reconnectCtx,
          action: 'apply-non-static',
        });
      }
    } catch (queueError) {
      console.warn('[mpesa:c2b] queue apply failed', {
        tenantId: customer.tenantId?.toString?.() || customer.tenantId,
        account: customer.accountNumber,
        connectionType: customer.connectionType || 'unknown',
        paymentId: payment._id?.toString?.() || payment._id,
        error: queueError?.message || queueError,
      });
    }

    console.log('[mpesa:c2b] payment recorded', {
      paymentId: payment._id.toString(),
      tenantId: customer.tenantId.toString(),
      account: customer.accountNumber,
      amount,
      transId: TransID,
      balance: OrgAccountBalance,
      validatedAt,
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[mpesa:c2b] confirmation error', {
      transId: TransID || null,
      shortcode: BusinessShortCode || null,
      account: BillRefNumber || null,
      error: err?.message || err,
    });
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

module.exports = router;


// Mpesa C2B (Customer to Business) routes
const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');
const MpesaSettings = require('../models/MpesaSettings');
const Customer = require('../models/customers');
const {
  hashValue,
  buildHeaderSnapshot,
  recordGatewayEvent,
  beginGatewayEventProcessing,
  finalizeGatewayEvent,
  shouldSkipDuplicate,
} = require('../services/paymentGatewayEventService');
const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');

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
        // Build query to search account number and aliases
        const q = { $or: [{ accountNumber: accountRef }, { accountAliases: accountRef }] };
        if (config.ispId) q.tenantId = config.ispId;
        customer = await Customer.findOne(q).lean();
        // If not found under tenant, try cross-tenant search
        if (!customer) {
          customer = await Customer.findOne({ $or: [{ accountNumber: accountRef }, { accountAliases: accountRef }] }).lean();
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
  const headers = buildHeaderSnapshot(req.headers);
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
  const dedupeKey = `mpesa:c2b:${TransID || ThirdPartyTransID || InvoiceNumber || hashValue(payload)}`;
  let gatewayEvent = null;
  let gatewayEventMeta = {
    provider: 'mpesa',
    kind: 'c2b-confirmation',
    dedupeKey,
    sourcePath: req.originalUrl,
    externalId: TransID || ThirdPartyTransID || InvoiceNumber || null,
    externalRef: InvoiceNumber || ThirdPartyTransID || null,
    transactionId: TransID || null,
    accountNumber: BillRefNumber ? String(BillRefNumber).trim() : null,
    phoneNumber: normalizeMsisdn(MSISDN) || null,
    amount: Number(TransAmount),
    payload,
    headers,
  };

  try {
    const recorded = await recordGatewayEvent(gatewayEventMeta);
    gatewayEvent = recorded.event;
    if (recorded.isDuplicate && shouldSkipDuplicate(gatewayEvent)) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    gatewayEvent = await beginGatewayEventProcessing(gatewayEvent._id);

    const config = await resolveConfig(BusinessShortCode);
    if (config?.ispId) {
      gatewayEventMeta.tenantId = config.ispId;
    }

    await processGatewayEvent(gatewayEvent);

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[mpesa:c2b] confirmation error', {
      transId: TransID || null,
      shortcode: BusinessShortCode || null,
      account: BillRefNumber || null,
      error: err?.message || err,
    });
    if (gatewayEvent?._id) {
      await finalizeGatewayEvent(gatewayEvent._id, {
        ...gatewayEventMeta,
        eventStatus: 'failed',
        processingError: err?.message || String(err),
      }).catch(() => {});
    }
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

module.exports = router;

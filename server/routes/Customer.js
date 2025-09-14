// routes/customers.js
const express = require('express');
const router = express.Router();

const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const {
  applyCustomerQueue,
  removeCustomerQueue,
  updateCustomerQueue,
} = require('../utils/mikrotikBandwidthManager');
const SmsSettings = require('../models/SmsSettings');
const SmsTemplate = require('../models/SmsTemplate');
const { createPayLink } = require('../utils/paylink');
const { renderTemplate, formatDateISO } = require('../utils/template');
const { sendSms } = require('../utils/sms');
const mongoose = require('mongoose');

// ----------------- Helpers -----------------
function generateAccountNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Make profiles shape robust: return [{ id, name, localAddress, rateLimit }]
function normalizeProfiles(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.profiles) ? raw.profiles : [];
  return arr
    .map((p, i) => {
      if (p == null) return null;
      // MikroTik usually: { '.id': '*1', name: 'profile', 'local-address': 'x', 'rate-limit': '10M/10M' }
      const id = String(p['.id'] ?? p.id ?? i);
      const name =
        String(
          p.name ??
            p.profile ??
            p.profileName ??
            p.title ??
            p.id ??
            p._id ??
            p['.id'] ??
            `profile_${i}`
        );
      const localAddress = p['local-address'] ?? p.localAddress ?? null;
      const rateLimit = p['rate-limit'] ?? p.rateLimit ?? '';
      return { id, name, localAddress, rateLimit };
    })
    .filter(Boolean);
}

// ----------------- PPPoE Profiles -----------------
const isYes = (v) => {
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'on';
};
router.get('/profiles', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    // Execute against tenant-scoped MikroTik connection (may throw if not configured)
    const profiles = await sendCommand('/ppp/profile/print', [], { tenantId, timeoutMs: 10000 });
    const formatted = normalizeProfiles(profiles);
    return res.json({ message: 'Profiles loaded from MikroTik', profiles: formatted });
  } catch (err) {
    console.error('profiles error:', err?.message || err);
    // Degrade gracefully so UI can proceed; surface message but avoid 500
    return res.json({
      message: 'No PPPoE profiles available (router not connected or unauthorized)',
      profiles: [],
      error: String(err?.message || err),
    });
  }
});

// ----------------- Customers: List -----------------
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find({ tenantId: req.tenantId })
      // add speed so UI and queue logic can use it consistently
      .populate('plan', 'name price duration speed')
      .lean();
    return res.json(customers);
  } catch (err) {
    console.error('list customers error:', err);
    return res.status(500).json({ message: 'Failed to retrieve customers' });
  }
});

// ----------------- Customers: Search -----------------
router.get('/search', async (req, res) => {
  const { query } = req.query;
  if (!query || !query.trim()) return res.json([]);

  try {
    const q = query.trim();
    const regex = new RegExp(q, 'i');
    const customers = await Customer.find(
      {
        tenantId: req.tenantId,
        $or: [
          { name: regex },
          { accountNumber: regex },
          { email: regex },
          { phone: regex },
          { address: regex },
        ],
      },
      // return concise fields for results list; full details fetched via /by-id
      { name: 1, accountNumber: 1, phone: 1, email: 1, address: 1, plan: 1 }
    )
      .limit(20)
      .populate('plan', 'name speed price')
      .lean();

    return res.json(customers);
  } catch (err) {
    console.error('customer search failed:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// ----------------- Detect Static Clients on MikroTik -----------------
// GET /api/customers/detect-static
// Heuristic: find simple queues (name = accountNumber) with a single target IP (/32 preferred),
// and any entries from STATIC_ALLOW/STATIC_BLOCK address-lists. Exclude existing customers.
router.get('/detect-static', async (req, res) => {
  try {
    const tenantId = req.tenantId;

    let queues = [];
    let allowList = [];
    let blockList = [];
    try {
      queues = await sendCommand('/queue/simple/print', [], { tenantId, timeoutMs: 12000 });
    } catch (_) {}

    try {
      allowList = await sendCommand('/ip/firewall/address-list/print', ['?list=STATIC_ALLOW'], { tenantId, timeoutMs: 8000 });
    } catch (_) {}
    try {
      blockList = await sendCommand('/ip/firewall/address-list/print', ['?list=STATIC_BLOCK'], { tenantId, timeoutMs: 8000 });
    } catch (_) {}

    // Build candidates from queues
    const candidates = [];
    function firstIpFromTarget(target) {
      if (!target) return null;
      const first = String(target).split(',')[0].trim();
      const ip = first.split('/')[0].trim();
      // very light validation
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
      return null;
    }

    for (const q of Array.isArray(queues) ? queues : []) {
      const name = String(q?.name || '').trim();
      const target = q?.target || q?.['target'] || '';
      const ip = firstIpFromTarget(target);
      if (!name || !ip) continue;
      const rate = String(q?.['max-limit'] || q?.maxLimit || q?.rate || '').trim();
      candidates.push({
        source: 'queue',
        accountNumber: name,
        ip,
        rateLimit: rate,
        comment: String(q?.comment || '').trim() || null,
      });
    }

    // Add from address-lists
    function pushFromList(arr, source) {
      for (const r of Array.isArray(arr) ? arr : []) {
        const ip = String(r?.address || '').trim();
        if (!ip) continue;
        const comment = String(r?.comment || '').trim() || null;
        // Try to infer accountNumber from comment if present
        const accountFromComment = (comment && comment.match(/acct[:#\s]*([A-Za-z0-9_-]+)/i))?.[1] || null;
        candidates.push({ source, accountNumber: accountFromComment, ip, rateLimit: '', comment });
      }
    }
    pushFromList(allowList, 'address-list-allow');
    pushFromList(blockList, 'address-list-block');

    // Exclude existing customers for this tenant (by accountNumber or staticConfig.ip)
    const existing = await Customer.find({ tenantId })
      .select('accountNumber staticConfig.ip')
      .lean();
    const haveAcc = new Set(existing.map((c) => String(c.accountNumber || '').trim()).filter(Boolean));
    const haveIp = new Set(
      existing.map((c) => (c?.staticConfig?.ip ? String(c.staticConfig.ip).trim() : '')).filter(Boolean)
    );

    const uniqKey = (r) => `${r.accountNumber || ''}|${r.ip}`;
    const seen = new Set();
    const out = [];
    for (const r of candidates) {
      const key = uniqKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      if (haveAcc.has(String(r.accountNumber || '').trim())) continue;
      if (haveIp.has(String(r.ip || '').trim())) continue;
      out.push(r);
    }

    return res.json({ ok: true, count: out.length, candidates: out });
  } catch (e) {
    console.error('detect-static failed:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to detect static clients' });
  }
});

// ----------------- Import Selected Static Clients -----------------
// POST /api/customers/import-static
// Body: { items: [{ accountNumber, ip, name?, phone?, address?, planId? }] }
router.post('/import-static', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: 'items required' });

    // Normalize + dedupe incoming items
    const normalized = [];
    const seen = new Set();
    for (const raw of items) {
      const accountNumber = String(raw?.accountNumber || '').trim();
      const ip = String(raw?.ip || '').trim();
      if (!accountNumber || !ip) continue;
      const key = `${accountNumber}|${ip}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ raw, accountNumber, ip });
    }
    if (!normalized.length) return res.status(400).json({ ok: false, error: 'No valid items' });

    // Fetch existing customers in a single query by accountNumber or staticConfig.ip
    const wantAcc = normalized.map(x => x.accountNumber);
    const wantIp = normalized.map(x => x.ip);
    const existing = await Customer.find({
      tenantId,
      $or: [
        { accountNumber: { $in: wantAcc } },
        { 'staticConfig.ip': { $in: wantIp } },
      ],
    }).select('accountNumber staticConfig.ip').lean();
    const haveAcc = new Set(existing.map(e => String(e.accountNumber || '').trim()).filter(Boolean));
    const haveIp = new Set(existing.map(e => String(e?.staticConfig?.ip || '').trim()).filter(Boolean));

    // Build docs to insert
    const docs = [];
    const results = [];
    for (const { raw, accountNumber, ip } of normalized) {
      if (haveAcc.has(accountNumber) || haveIp.has(ip)) {
        results.push({ ok: false, error: 'exists', accountNumber, ip });
        continue;
      }

      const doc = {
        tenantId,
        name: String(raw.name || raw.comment || accountNumber),
        email: String(raw.email || ''),
        phone: String(raw.phone || ''),
        address: String(raw.address || ''),
        accountNumber,
        status: 'active',
        connectionType: 'static',
        staticConfig: { ip },
      };
      if (raw.planId && mongoose.Types.ObjectId.isValid(String(raw.planId))) {
        doc.plan = String(raw.planId);
      }
      docs.push(doc);
    }

    let inserted = [];
    if (docs.length) {
      try {
        inserted = await Customer.insertMany(docs, { ordered: false });
      } catch (e) {
        // insertMany with ordered:false returns partial success; continue to build results
        // e.writeErrors may contain duplicates; we'll still compute results below
        console.warn('insertMany issues:', e?.message || e);
      }
    }

    // Map successful inserts by accountNumber+ip
    const okSet = new Set((inserted || []).map(d => `${String(d.accountNumber)}|${String(d?.staticConfig?.ip || '')}`));
    for (const { accountNumber, ip } of docs) {
      const key = `${accountNumber}|${ip}`;
      if (okSet.has(key)) results.push({ ok: true, accountNumber, ip });
      else if (![...results].some(r => r.accountNumber === accountNumber && r.ip === ip)) results.push({ ok: false, accountNumber, ip, error: 'not inserted' });
    }

    return res.json({ ok: true, imported: results.filter(r => r.ok).length, results });
  } catch (e) {
    console.error('import-static failed:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to import static clients' });
  }
});

// ----------------- Customers: Get by ID -----------------
router.get('/by-id/:id', async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    return res.json(customer);
  } catch (err) {
    console.error('by-id error:', err);
    return res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// ----------------- Customers: Get by Account -----------------
router.get('/by-account/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber, tenantId: req.tenantId })
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    return res.json(customer);
  } catch (err) {
    console.error('by-account error:', err);
    return res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// ----------------- Create Customer -----------------
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      routerIp,
      plan: planId,
      connectionType, // "pppoe" | "static"
      pppoeConfig,
      staticConfig,
    } = req.body;

    const accountNumber = String(generateAccountNumber()).trim();

    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    if (connectionType === 'pppoe' && (!pppoeConfig || !pppoeConfig.profile)) {
      return res.status(400).json({ message: 'PPPoE profile is required for PPPoE connections' });
    }

    const customer = new Customer({
      tenantId: req.tenantId,
      name,
      email,
      phone,
      address,
      routerIp: routerIp || null,
      status: 'active',
      accountNumber,
      plan: planId,
      connectionType,
      pppoeConfig:
        connectionType === 'pppoe'
          ? {
              profile: pppoeConfig.profile,
              localAddress: pppoeConfig.localAddress || null,
              // keep consistent with plan.speed (Mbps)
              rateLimit: `${plan.speed}M/0M`,
            }
          : undefined,
      staticConfig: connectionType === 'static' ? staticConfig : undefined,
    });

    const newCustomer = await customer.save();

    if (connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      const words = [
        `=name=${accountNumber}`,
        `=password=defaultpass`,
        `=profile=${pppoeConfig.profile}`,
        `=service=pppoe`,
        `=comment=Customer: ${name}`,
      ];
      try {
        await sendCommand('/ppp/secret/add', words, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        console.error('MikroTik add secret failed:', e?.message || e);
        await Customer.findByIdAndDelete(newCustomer._id);
        return res.status(500).json({ message: 'Failed to create PPPoE secret: ' + (e?.message || e) });
      }
    }

    try {
      await applyCustomerQueue(newCustomer, plan);
    } catch (e) {
      console.warn('Queue apply failed:', e?.message || e);
    }

    // Optional: Auto-send paylink SMS on customer creation
    try {
      const smsCfg = await SmsSettings.findOne({ tenantId: req.tenantId }).lean();
      if (smsCfg?.enabled && smsCfg?.autoSendOnCreate) {
        const templateType = smsCfg?.autoTemplateType || 'payment-link';
        const tmpl = await SmsTemplate.findOne({ tenantId: req.tenantId, type: templateType, active: true }).lean();
        const body = tmpl?.body || 'Hi {{name}}, your {{plan_name}} (KES {{amount}}). Pay: {{payment_link}}';
        const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        const { url } = await createPayLink({ tenantId: req.tenantId, customerId: newCustomer._id, planId: plan._id, dueAt });
        const rendered = renderTemplate(body, {
          name: newCustomer.name || 'Customer',
          plan_name: plan.name || 'Plan',
          amount: String(plan.price ?? ''),
          expiry_date: formatDateISO(dueAt),
          payment_link: url,
        });
        if (newCustomer.phone) {
          await sendSms(req.tenantId, newCustomer.phone, rendered);
        }
      }
    } catch (e) {
      console.warn('Auto-send paylink SMS failed:', e?.message || e);
    }

    return res.status(201).json({ message: 'Customer created successfully', customer: newCustomer });
  } catch (err) {
    console.error('Create customer failed:', err);
    return res.status(400).json({ message: 'Failed to create customer: ' + err.message });
  }
});

// ----------------- Update Customer -----------------
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const { plan: planId, connectionType, pppoeConfig, staticConfig } = req.body;
    const originalPlanId = customer.plan ? String(customer.plan) : '';
    const plan = await Plan.findOne({ _id: (planId || customer.plan), tenantId: req.tenantId });
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    // Detect account rename and propagate to MikroTik (PPP secret / simple queue)
    const prevAccount = String(customer.accountNumber || '').trim();
    const nextAccount = String(req.body?.accountNumber || prevAccount).trim();
    const nextName = String(req.body?.name || customer.name || nextAccount);
    const tenantId = req.tenantId;
    if (prevAccount && nextAccount && prevAccount !== nextAccount) {
      // Rename PPP secret if present
      try {
        const list = await sendCommand('/ppp/secret/print', [`?name=${prevAccount}`], { tenantId, timeoutMs: 10000 });
        if (Array.isArray(list) && list[0]) {
          const id = list[0]['.id'] || list[0].id || list[0].numbers;
          await sendCommand('/ppp/secret/set', [
            `=numbers=${id}`,
            `=name=${nextAccount}`,
            `=comment=Customer: ${nextName}`,
          ], { tenantId, timeoutMs: 10000 });
        }
      } catch (e) {
        console.warn('PPP secret rename failed:', e?.message || e);
      }

      // Rename Static queue if present
      try {
        const q = await sendCommand('/queue/simple/print', [`?name=${prevAccount}`], { tenantId, timeoutMs: 8000 });
        if (Array.isArray(q) && q[0]) {
          const qid = q[0]['.id'] || q[0].id || q[0].numbers;
          await sendCommand('/queue/simple/set', [
            `=numbers=${qid}`,
            `=name=${nextAccount}`,
            `=comment=Customer: ${nextName}`,
          ], { tenantId, timeoutMs: 8000 });
        }
      } catch (e) {
        console.warn('Queue rename failed:', e?.message || e);
      }
    }

    // Apply basic updates
    Object.assign(customer, req.body);

    if (connectionType === 'pppoe') {
      if (!pppoeConfig?.profile) return res.status(400).json({ message: 'PPPoE profile required' });
      customer.staticConfig = undefined;
      customer.pppoeConfig = {
        profile: pppoeConfig.profile,
        localAddress: pppoeConfig.localAddress || null,
        rateLimit: `${plan.speed}M/0M`,
      };

      // Update PPP secret on MikroTik: find by name (accountNumber), fallback to previous, then set by .id
      try {
        let list = await sendCommand('/ppp/secret/print', [`?name=${customer.accountNumber}`], { tenantId, timeoutMs: 10000 });
        if (!Array.isArray(list) || !list[0]) {
          list = await sendCommand('/ppp/secret/print', [`?name=${prevAccount}`], { tenantId, timeoutMs: 10000 });
        }
        if (!Array.isArray(list) || !list[0]) return res.status(404).json({ message: 'PPPoE secret not found on MikroTik for this account' });
        const id = list[0]['.id'] || list[0].id || list[0].numbers;
        const setWords = [
          `=numbers=${id}`,
          `=profile=${pppoeConfig.profile}`,
          `=comment=Customer: ${customer.name || customer.accountNumber}`,
        ];
        await sendCommand('/ppp/secret/set', setWords, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        return res.status(500).json({ message: 'Failed to update PPPoE secret: ' + (e?.message || e) });
      }
    } else if (connectionType === 'static') {
      customer.pppoeConfig = undefined;
      customer.staticConfig = staticConfig;
    }

    const updated = await customer.save();

    try {
      await updateCustomerQueue(customer, plan);
    } catch (e) {
      console.warn('Queue update failed:', e?.message || e);
    }

    // If plan was assigned/changed, optionally auto-send paylink SMS (separate toggle)
    try {
      const newPlanId = updated.plan ? String(updated.plan) : '';
      const planChanged = newPlanId && newPlanId !== originalPlanId;
      if (planChanged) {
        const SmsSettings = require('../models/SmsSettings');
        const SmsTemplate = require('../models/SmsTemplate');
        const { createPayLink } = require('../utils/paylink');
        const { renderTemplate, formatDateISO } = require('../utils/template');
        const { sendSms } = require('../utils/sms');

        const smsCfg = await SmsSettings.findOne({ tenantId: req.tenantId }).lean();
        if (smsCfg?.enabled && smsCfg?.autoSendOnPlanChange) {
          const templateType = smsCfg?.autoTemplateType || 'payment-link';
          const tmpl = await SmsTemplate.findOne({ tenantId: req.tenantId, type: templateType, active: true }).lean();
          const body = tmpl?.body || 'Hi {{name}}, your {{plan_name}} (KES {{amount}}). Pay: {{payment_link}}';
          const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
          const { url } = await createPayLink({ tenantId: req.tenantId, customerId: updated._id, planId: updated.plan, dueAt });
          const rendered = renderTemplate(body, {
            name: updated.name || 'Customer',
            plan_name: plan.name || 'Plan',
            amount: String(plan.price ?? ''),
            expiry_date: formatDateISO(dueAt),
            payment_link: url,
          });
          if (updated.phone) {
            await sendSms(req.tenantId, updated.phone, rendered);
          }
        }
      }
    } catch (e) {
      console.warn('Auto-send on plan change failed:', e?.message || e);
    }

    return res.json({ message: 'Customer updated successfully', customer: updated });
  } catch (err) {
    console.error('Update customer failed:', err);
    return res.status(400).json({ message: 'Failed to update customer: ' + err.message });
  }
});

// ----------------- Delete Customer -----------------
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    if (customer.connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      const words = [`=numbers=${customer.accountNumber}`];
      try {
        await sendCommand('/ppp/secret/remove', words, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        console.warn('PPPoE secret remove failed:', e?.message || e);
      }
    }

    try {
      await removeCustomerQueue(customer);
    } catch (e) {
      console.warn('Queue remove failed:', e?.message || e);
    }

    return res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Delete customer failed:', err);
    return res.status(500).json({ message: 'Error deleting customer: ' + err.message });
  }
});

module.exports = router;

// ------------- After exports guard to satisfy linter (placed logically above in real app) -------------

// NOTE: Health endpoint lives here to tie MikroTik state to a specific customer/account
// GET /api/customers/health/:accountNumber
router.get('/health/:accountNumber', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const accountNumber = String(req.params.accountNumber);

    const customer = await Customer.findOne({ tenantId, accountNumber })
      .populate('plan', 'name speed price duration')
      .lean();

    if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found' });

    const out = {
      ok: true,
      accountNumber,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      plan: customer.plan || null,
      connectionType: customer.connectionType,
      disabled: null,
      online: false,
      uptime: null,
      bytesIn: 0,
      bytesOut: 0,
      addressIp: null,
      deviceCount: null, // hotspot sessions count or PPPoE=1 if online
    };

    // PPPoE health
    if (customer.connectionType === 'pppoe') {
      let secret = [];
      let active = [];
      try {
        secret = await sendCommand('/ppp/secret/print', [`?name=${accountNumber}`], { tenantId, timeoutMs: 10000 });
      } catch (_) {}
      try {
        active = await sendCommand('/ppp/active/print', [`?name=${accountNumber}`], { tenantId, timeoutMs: 8000 });
      } catch (_) {}

      const s0 = Array.isArray(secret) ? secret[0] : null;
      const a0 = Array.isArray(active) ? active[0] : null;
      const disabledVal = (s0 && (s0.disabled ?? s0['disabled'])) ?? 'no';
      const disabled = isYes(disabledVal);

      out.disabled = disabled;
      out.online = !!a0;
      out.uptime = a0?.uptime || null;
      out.bytesIn = Number(a0?.['bytes-in'] || a0?.rx || 0) || 0;
      out.bytesOut = Number(a0?.['bytes-out'] || a0?.tx || 0) || 0;
      out.addressIp = a0?.address || a0?.['remote-address'] || null;
      out.deviceCount = out.online ? 1 : 0;
      out.status = disabled ? 'inactive' : 'active';
      return res.json(out);
    }

    // Static IP: reflect queue status if present and approximate online via ARP
    if (customer.connectionType === 'static') {
      const ip = customer?.staticConfig?.ip || null;
      let queues = [];
      let arp = [];
      try {
        queues = await sendCommand('/queue/simple/print', [`?name=${accountNumber}`], { tenantId, timeoutMs: 8000 });
      } catch (_) {}
      try {
        if (ip) arp = await sendCommand('/ip/arp/print', [`?address=${ip}`], { tenantId, timeoutMs: 6000 });
      } catch (_) {}

      const q0 = Array.isArray(queues) ? queues[0] : null;
      const qDisabledVal = q0?.disabled ?? 'no';
      const disabled = isYes(qDisabledVal);
      const arpHit = Array.isArray(arp) && arp.length > 0;

      out.disabled = disabled;
      out.status = disabled ? 'inactive' : 'active';
      out.online = !!arpHit; // approximate: present in ARP table
      out.deviceCount = arpHit ? 1 : 0;
      return res.json(out);
    }

    // default fallback
    out.status = customer.status || 'active';
    return res.json(out);
  } catch (e) {
    console.error('health endpoint failed:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to fetch health' });
  }
});

// ----------------- List Disabled/Inactive on Router -----------------
// Provides a quick way to list accounts that are disabled on the router, to re-enable from UI.
// GET /api/customers/disabled
router.get('/disabled', async (req, res) => {
  const tenantId = req.tenantId;
  try {
    let secrets = [];
    let queues = [];
    try {
      secrets = await sendCommand('/ppp/secret/print', [], { tenantId, timeoutMs: 12000 });
    } catch (e) {
      secrets = [];
    }
    try {
      queues = await sendCommand('/queue/simple/print', [], { tenantId, timeoutMs: 10000 });
    } catch (e) {
      queues = [];
    }

    const pppoe = [];
    const staticQ = [];

    const disabledYes = (v) => isYes(v);

    // map PPPoE disabled secrets
    for (const s of Array.isArray(secrets) ? secrets : []) {
      const name = s?.name || s?.user || s?.username;
      if (!name) continue;
      if (disabledYes(s?.disabled)) {
        pppoe.push({ accountNumber: String(name), disabled: true });
      }
    }

    // map Static queues disabled
    for (const q of Array.isArray(queues) ? queues : []) {
      const name = q?.name;
      if (!name) continue;
      if (disabledYes(q?.disabled)) {
        staticQ.push({ accountNumber: String(name), disabled: true });
      }
    }

    // attach minimal customer info if exists
    const allAccounts = [...pppoe, ...staticQ].map((x) => x.accountNumber);
    const customers = await Customer.find({ tenantId, accountNumber: { $in: allAccounts } })
      .select('accountNumber name phone email address plan connectionType')
      .populate('plan', 'name speed price')
      .lean();
    const byAcct = new Map(customers.map((c) => [String(c.accountNumber), c]));
    const attach = (arr) => arr.map((x) => ({ ...x, customer: byAcct.get(x.accountNumber) || null }));

    return res.json({ ok: true, pppoe: attach(pppoe), static: attach(staticQ) });
  } catch (e) {
    console.error('list disabled failed:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to load disabled users' });
  }
});

module.exports = router;

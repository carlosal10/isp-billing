// routes/customers.js
const express = require('express');
const router = express.Router();

const mongoose = require('mongoose');
const Customer = require('../models/customers');
const Tenant = require('../models/Tenant');
const Plan = require('../models/plan');
const { deriveAccountCode } = require('../utils/accountNumber');

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

/* ------------------------- Helpers ------------------------- */

const isYes = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'on';
};
function accountKeys(value) {
  const raw = (value == null ? '' : String(value)).trim();
  if (!raw) return [];
  const keys = new Set();
  const push = (key) => {
    if (key) keys.add(key);
  };
  push(raw);
  push(raw.toUpperCase());
  push(raw.toLowerCase());
  const compact = raw.replace(/[^A-Za-z0-9]/g, '');
  if (compact && compact !== raw) {
    push(compact);
    push(compact.toUpperCase());
    push(compact.toLowerCase());
  }
  return Array.from(keys);
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

/* --------------------- List & Search ----------------------- */

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find({ tenantId: req.tenantId })
      .populate('plan', 'name price duration speed')
      .lean();
    res.json(customers);
  } catch (err) {
    console.error('list customers error:', err);
    res.status(500).json({ message: 'Failed to retrieve customers' });
  }
});

// GET /api/customers/search?query=...
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
      { name: 1, accountNumber: 1, phone: 1, email: 1, address: 1, plan: 1 }
    )
      .limit(20)
      .populate('plan', 'name speed price')
      .lean();

    res.json(customers);
  } catch (err) {
    console.error('customer search failed:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/* ------------------ Fetch Single Customer ------------------ */

// GET /api/customers/by-id/:id
router.get('/by-id/:id', async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    console.error('by-id error:', err);
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// GET /api/customers/by-account/:accountNumber
router.get('/by-account/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber, tenantId: req.tenantId })
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    console.error('by-account error:', err);
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

/* ---------------------- Create Customer -------------------- */

// POST /api/customers
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      routerIp,
      plan: planId,
      connectionType, // 'pppoe' | 'static'
      pppoeConfig,
      staticConfig,
      accountAliases,
    } = req.body || {};

    // Validate plan
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    // Validate connection type specifics
    if (connectionType === 'pppoe') {
      if (!pppoeConfig?.profile) {
        return res.status(400).json({ message: 'PPPoE profile is required for PPPoE connections' });
      }
    } else if (connectionType === 'static') {
      if (!staticConfig?.ip) {
        return res.status(400).json({ message: 'Static IP is required for static connections' });
      }
      // Enforce unique static IP per tenant
      const ipExists = await Customer.findOne({ tenantId: req.tenantId, 'staticConfig.ip': staticConfig.ip }).lean();
      if (ipExists) return res.status(400).json({ message: 'Static IP already assigned to another customer' });
    } else {
      return res.status(400).json({ message: 'Invalid connection type' });
    }

    // Generate tenant-aware account number: <prefix><address-code> (fallback to random)
    let accountNumber = '';
    try {
      const tenant = await Tenant.findById(req.tenantId).lean();
      const prefix = (tenant?.accountPrefix || '').trim();
      const baseCode = deriveAccountCode(address || name || phone || 'CUST');
      let candidate = (prefix ? prefix : '') + baseCode;
      // ensure uniqueness per-tenant by suffixing if needed
      let attempt = 0;
      while (attempt < 5) {
        const exists = await Customer.findOne({ tenantId: req.tenantId, accountNumber: candidate }).select('_id').lean();
        if (!exists) { accountNumber = candidate; break; }
        attempt += 1;
        const suffix = '-' + (attempt + 1);
        candidate = ((prefix ? prefix : '') + baseCode).slice(0, Math.max(1, 16 - suffix.length)) + suffix;
      }
      if (!accountNumber) {
        // fallback random
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        accountNumber = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      }
    } catch {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      accountNumber = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    const initialAliases = sanitizeAliases(accountAliases, accountNumber);

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
              // keep tied to plan speed (upload 0 => unlimited; adjust to your policy)
              rateLimit: `${plan.speed}M/0M`,
            }
          : undefined,
      staticConfig: connectionType === 'static' ? staticConfig : undefined,
      accountAliases: initialAliases,
    });

    const saved = await customer.save();

    // MikroTik provisioning
    if (connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      const genPass = () => Math.random().toString(36).slice(-10);
      const secretPass = pppoeConfig?.password || genPass();
      try {
        await sendCommand('/ppp/secret/add', [
          `=name=${accountNumber}`,
          `=password=${secretPass}`,
          `=profile=${pppoeConfig.profile}`,
          `=service=pppoe`,
          `=comment=Customer: ${name || accountNumber}`,
        ], { tenantId, timeoutMs: 10000 });
      } catch (e) {
        console.error('MikroTik add secret failed:', e?.message || e);
        await Customer.findByIdAndDelete(saved._id);
        return res.status(500).json({ message: 'Failed to create PPPoE secret: ' + (e?.message || e) });
      }
    }

    // Apply queue (best-effort)
    try {
      await applyCustomerQueue(saved, plan);
    } catch (e) {
      console.warn('Queue apply failed:', e?.message || e);
    }

    // Optional: send paylink SMS on creation (best-effort)
    try {
      const smsCfg = await SmsSettings.findOne({ tenantId: req.tenantId }).lean();
      if (smsCfg?.enabled && smsCfg?.autoSendOnCreate) {
        const templateType = smsCfg?.autoTemplateType || 'payment-link';
        const tmpl = await SmsTemplate.findOne({ tenantId: req.tenantId, type: templateType, active: true }).lean();
        const body = tmpl?.body || 'Hi {{name}}, your {{plan_name}} (KES {{amount}}). Pay: {{payment_link}}';
        const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        const { url } = await createPayLink({ tenantId: req.tenantId, customerId: saved._id, planId: plan._id, dueAt });
        const rendered = renderTemplate(body, {
          name: saved.name || 'Customer',
          plan_name: plan.name || 'Plan',
          amount: String(plan.price ?? ''),
          expiry_date: formatDateISO(dueAt),
          payment_link: url,
        });
        if (saved.phone) await sendSms(req.tenantId, saved.phone, rendered);
      }
    } catch (e) {
      console.warn('Auto-send paylink SMS failed:', e?.message || e);
    }

    res.status(201).json({ message: 'Customer created successfully', customer: saved });
  } catch (err) {
    console.error('Create customer failed:', err);
    res.status(400).json({ message: 'Failed to create customer: ' + err.message });
  }
});

/* ---------------------- Update Customer -------------------- */

// PUT /api/customers/:id
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const originalPlanId = customer.plan ? String(customer.plan) : '';

    // Allowlist fields
    const allowed = (({
      name, email, phone, address, status, plan, connectionType, pppoeConfig, staticConfig, accountNumber, accountAliases
    }) => ({ name, email, phone, address, status, plan, connectionType, pppoeConfig, staticConfig, accountNumber, accountAliases }))(req.body || {});
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);

    // Validate plan (either provided or keep existing)
    const selectedPlanId = allowed.plan || customer.plan;
    const plan = await Plan.findOne({ _id: selectedPlanId, tenantId: req.tenantId });
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    // Handle accountNumber rename (propagate to router)
    const prevAccount = String(customer.accountNumber || '').trim();
    const nextAccount = String(allowed.accountNumber || prevAccount).trim();
    const nextName = String(allowed.name ?? customer.name ?? nextAccount);

    const tenantId = req.tenantId;
    if (prevAccount && nextAccount && prevAccount !== nextAccount) {
      // PPP secret rename (best-effort)
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

      // Simple queue rename (best-effort)
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

    const manualAliases =
      allowed.accountAliases !== undefined
        ? sanitizeAliases(allowed.accountAliases, nextAccount)
        : null;

    // Maintain alias history so legacy PPPoE usernames (old account numbers) still map in the UI.
    if (prevAccount && prevAccount !== nextAccount) {
      const baseAliases =
        manualAliases !== null
          ? manualAliases
          : sanitizeAliases(customer.accountAliases, nextAccount);
      const aliasSet = new Set(baseAliases);
      aliasSet.add(prevAccount);
      customer.accountAliases = Array.from(aliasSet).slice(0, 10);
    } else if (manualAliases !== null) {
      customer.accountAliases = manualAliases;
    }

    // Connection-type specifics
    if (allowed.connectionType === 'pppoe') {
      if (!allowed.pppoeConfig?.profile) {
        return res.status(400).json({ message: 'PPPoE profile required' });
      }
      // switch to PPPoE
      customer.staticConfig = undefined;
      customer.pppoeConfig = {
        profile: allowed.pppoeConfig.profile,
        localAddress: allowed.pppoeConfig.localAddress || null,
        rateLimit: `${plan.speed}M/0M`,
      };

      // Update PPP secret (best-effort but fail if not found)
      try {
        const searchKeys = [];
        const pushKey = (value) => {
          const v = String(value || '').trim();
          if (!v) return;
          if (!searchKeys.includes(v)) searchKeys.push(v);
        };
        pushKey(nextAccount);
        pushKey(prevAccount);
        if (Array.isArray(customer.accountAliases)) {
          for (const alias of customer.accountAliases) pushKey(alias);
        }
        if (Array.isArray(allowed.accountAliases)) {
          for (const alias of allowed.accountAliases) pushKey(alias);
        }

        let secret = null;
        for (const key of searchKeys) {
          const list = await sendCommand('/ppp/secret/print', [`?name=${key}`], { tenantId, timeoutMs: 10000 });
          if (Array.isArray(list) && list[0]) {
            secret = list[0];
            break;
          }
        }

        if (!secret) {
          return res.status(404).json({ message: 'PPPoE secret not found on MikroTik for this account' });
        }
        const id = secret['.id'] || secret.id || secret.numbers;
        const existingName = secret.name || secret.user || secret.username || null;
        const commands = [
          `=numbers=${id}`,
          `=profile=${allowed.pppoeConfig.profile}`,
          `=comment=Customer: ${nextName}`,
        ];
        if (existingName && existingName !== nextAccount) {
          commands.push(`=name=${nextAccount}`);
        }
        await sendCommand('/ppp/secret/set', commands, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        return res.status(500).json({ message: 'Failed to update PPPoE secret: ' + (e?.message || e) });
      }
    } else if (allowed.connectionType === 'static') {
      // switch to Static
      if (!allowed.staticConfig?.ip) {
        return res.status(400).json({ message: 'Static IP is required for static connections' });
      }
      // prevent duplicate IP (if changed)
      if (allowed.staticConfig.ip !== customer?.staticConfig?.ip) {
        const exists = await Customer.findOne({
          tenantId: req.tenantId,
          'staticConfig.ip': allowed.staticConfig.ip,
          _id: { $ne: customer._id },
        }).lean();
        if (exists) return res.status(400).json({ message: 'Static IP already assigned to another customer' });
      }
      customer.pppoeConfig = undefined;
      customer.staticConfig = { ...allowed.staticConfig };
    }

    // Apply base fields after validations
    customer.name = nextName;
    customer.email = allowed.email ?? customer.email;
    customer.phone = allowed.phone ?? customer.phone;
    customer.address = allowed.address ?? customer.address;
    customer.status = allowed.status ?? customer.status;
    customer.plan = selectedPlanId;
    customer.accountNumber = nextAccount;

    const updated = await customer.save();

    // Sync queue with latest plan (best-effort)
    try {
      await updateCustomerQueue(updated, plan);
    } catch (e) {
      console.warn('Queue update failed:', e?.message || e);
    }

    // Optional: auto-send paylink on plan change (best-effort)
    try {
      const newPlanId = updated.plan ? String(updated.plan) : '';
      const planChanged = newPlanId && newPlanId !== originalPlanId;
      if (planChanged) {
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
          if (updated.phone) await sendSms(req.tenantId, updated.phone, rendered);
        }
      }
    } catch (e) {
      console.warn('Auto-send on plan change failed:', e?.message || e);
    }

    res.json({ message: 'Customer updated successfully', customer: updated });
  } catch (err) {
    console.error('Update customer failed:', err);
    res.status(400).json({ message: 'Failed to update customer: ' + err.message });
  }
});

/* ---------------------- Delete Customer -------------------- */

// DELETE /api/customers/:id
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    // Remove PPP secret (best-effort; resolve .id first)
    if (customer.connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      try {
        const list = await sendCommand('/ppp/secret/print', [`?name=${customer.accountNumber}`], { tenantId, timeoutMs: 10000 });
        if (Array.isArray(list) && list[0]) {
          const id = list[0]['.id'] || list[0].id || list[0].numbers;
          await sendCommand('/ppp/secret/remove', [`=numbers=${id}`], { tenantId, timeoutMs: 10000 });
        }
      } catch (e) {
        console.warn('PPPoE secret remove failed:', e?.message || e);
      }
    }

    // Remove queue (best-effort)
    try {
      await removeCustomerQueue(customer);
    } catch (e) {
      console.warn('Queue remove failed:', e?.message || e);
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Delete customer failed:', err);
    res.status(500).json({ message: 'Error deleting customer: ' + err.message });
  }
});

/* ------------------- Customer Health Probe ----------------- */

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
      status: customer.status || 'active',
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

    // Static IP health (approximate online via ARP, show queue disabled status)
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
      out.online = !!arpHit;
      out.deviceCount = arpHit ? 1 : 0;
      return res.json(out);
    }

    return res.json(out);
  } catch (e) {
    console.error('health endpoint failed:', e?.message || e);
    res.status(500).json({ ok: false, error: 'Failed to fetch health' });
  }
});

/* ------------------- Disabled/Inactive List ---------------- */

// GET /api/customers/disabled
router.get('/disabled', async (req, res) => {
  const tenantId = req.tenantId;
  try {
    let secrets = [];
    let queues = [];
    try {
      secrets = await sendCommand('/ppp/secret/print', [], { tenantId, timeoutMs: 12000 });
    } catch (e) { secrets = []; }
    try {
      queues = await sendCommand('/queue/simple/print', [], { tenantId, timeoutMs: 10000 });
    } catch (e) { queues = []; }

    const pppoe = [];
    const staticQ = [];

    // PPPoE disabled
    for (const s of Array.isArray(secrets) ? secrets : []) {
      const name = s?.name || s?.user || s?.username;
      if (!name) continue;
      if (isYes(s?.disabled)) pppoe.push({ accountNumber: String(name), disabled: true });
    }

    // Static queues disabled
    for (const q of Array.isArray(queues) ? queues : []) {
      const name = q?.name;
      if (!name) continue;
      if (isYes(q?.disabled)) staticQ.push({ accountNumber: String(name), disabled: true });
    }

    // Attach customer info
    const allAccounts = [...pppoe, ...staticQ].map((x) => x.accountNumber);
    const customers = await Customer.find({
      tenantId,
      $or: [
        { accountNumber: { $in: allAccounts } },
        { accountAliases: { $in: allAccounts } },
      ],
    })
      .select('accountNumber name phone email address plan connectionType accountAliases')
      .populate('plan', 'name speed price')
      .lean();
    const byKey = new Map();
    const register = (key, customer) => {
      const raw = String(key || '').trim();
      if (!raw) return;
      for (const variant of accountKeys(raw)) {
        if (!byKey.has(variant)) byKey.set(variant, customer);
      }
    };
    for (const customer of customers) {
      register(customer.accountNumber, customer);
      if (Array.isArray(customer.accountAliases)) {
        for (const alias of customer.accountAliases) {
          register(alias, customer);
        }
      }
    }
    const attach = (arr) =>
      arr.map((x) => {
        let customer = null;
        for (const key of accountKeys(x.accountNumber)) {
          customer = byKey.get(key);
          if (customer) break;
        }
        if (!customer) {
          const fallback = String(x.accountNumber || '').trim();
          if (fallback) customer = byKey.get(fallback);
        }
        return { ...x, customer: customer || null };
      });

    res.json({ ok: true, pppoe: attach(pppoe), static: attach(staticQ) });
  } catch (e) {
    console.error('list disabled failed:', e?.message || e);
    res.status(500).json({ ok: false, error: 'Failed to load disabled users' });
  }
});

module.exports = router;

'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const PortalChallenge = require('../models/PortalChallenge');
const Customer = require('../models/customers');
const { sendSms } = require('../utils/sms');

function digest(id, code) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${id}:${code}`).digest('hex');
}

async function issuePortalChallenge({ tenant, customer }, { deliver = sendSms } = {}) {
  const challengeId = crypto.randomBytes(24).toString('hex');
  // Identical response for unknown, disabled, and undeliverable accounts.
  if (tenant && customer?.phone && customer.portalProfile?.isEnabled !== false) {
    const code = String(crypto.randomInt(100000, 1000000));
    await PortalChallenge.create({ _id: challengeId, tenantId: tenant._id,
      customerId: customer._id, digest: digest(challengeId, code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    try {
      await deliver(String(tenant._id), customer.phone, `Your portal verification code is ${code}. It expires in 10 minutes. Do not share it.`);
    } catch {
      await PortalChallenge.deleteOne({ _id: challengeId });
    }
  }
  return { ok: true, challengeId, message: 'If this account can receive messages, a code has been sent to its registered phone.' };
}

async function completePortalChallenge({ challengeId, code, newPin }) {
  const invalid = () => Object.assign(new Error('Invalid or expired verification code'), { statusCode: 400 });
  if (!/^[a-f0-9]{48}$/.test(String(challengeId)) || !/^\d{6}$/.test(String(code)) || !/^\d{6,8}$/.test(String(newPin))) throw invalid();
  const challenge = await PortalChallenge.findOneAndUpdate({
    _id: challengeId, consumedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 },
  }, { $inc: { attempts: 1 } }, { new: true }).lean();
  if (!challenge || !crypto.timingSafeEqual(Buffer.from(challenge.digest, 'hex'), Buffer.from(digest(challengeId, code), 'hex'))) throw invalid();
  const pinHash = await bcrypt.hash(String(newPin), 12);
  await mongoose.connection.transaction(async (session) => {
    const consumed = await PortalChallenge.updateOne({ _id: challengeId, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } }, { session });
    if (!consumed.modifiedCount) throw invalid();
    const updated = await Customer.updateOne({ _id: challenge.customerId, tenantId: challenge.tenantId, 'portalProfile.isEnabled': { $ne: false } },
      { $set: { 'portalProfile.pinHash': pinHash }, $inc: { 'portalProfile.sessionVersion': 1 } }, { session });
    if (!updated.modifiedCount) throw invalid();
  });
  return { ok: true, message: 'PIN saved. Sign in with your new PIN.' };
}
module.exports = { issuePortalChallenge, completePortalChallenge };

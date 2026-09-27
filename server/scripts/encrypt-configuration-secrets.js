#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const PaymentConfig = require('../models/PaymentConfig');
const MpesaSettings = require('../models/MpesaSettings');
const MikroTikConnection = require('../models/MikrotikConnection');
const SmsSettings = require('../models/SmsSettings');
const {
  PAYMENT_SECRET_FIELDS,
  SMS_SECRET_PATHS,
  decryptField,
  encryptField,
  getEncryptionKeyring,
  isEncryptedField,
} = require('../security/fieldEncryption');

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function encryptedKeyId(value) {
  return isEncryptedField(value) ? String(value).split(':')[2] || null : null;
}

function buildSecretPatch(document, paths, { keyring, rotate = false } = {}) {
  const $set = {};
  for (const dottedPath of paths) {
    const value = getPath(document, dottedPath);
    if (typeof value !== 'string' || value === '') continue;
    if (isEncryptedField(value)) {
      if (!rotate || encryptedKeyId(value) === keyring.activeKeyId) continue;
      $set[dottedPath] = encryptField(decryptField(value, { keyring }), { keyring });
      continue;
    }
    $set[dottedPath] = encryptField(value, { keyring });
  }
  return $set;
}

async function processCollection({ label, model, paths, keyring, rotate, write }) {
  const projection = { _id: 1 };
  paths.forEach((field) => { projection[field] = 1; });
  const cursor = model.collection.find({}, { projection });
  let scanned = 0;
  let changed = 0;
  let operations = [];

  for await (const document of cursor) {
    scanned += 1;
    const $set = buildSecretPatch(document, paths, { keyring, rotate });
    if (!Object.keys($set).length) continue;
    changed += 1;
    if (!write) continue;
    operations.push({ updateOne: { filter: { _id: document._id }, update: { $set } } });
    if (operations.length >= 250) {
      await model.collection.bulkWrite(operations, { ordered: false });
      operations = [];
    }
  }
  if (write && operations.length) {
    await model.collection.bulkWrite(operations, { ordered: false });
  }
  return { label, scanned, changed, write };
}

async function main() {
  const write = process.argv.includes('--write');
  const rotate = process.argv.includes('--rotate');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required');
  const keyring = getEncryptionKeyring(process.env);

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  try {
    const mpesaFields = PAYMENT_SECRET_FIELDS.mpesa;
    const reports = [];
    reports.push(await processCollection({ label: 'PaymentConfig', model: PaymentConfig, paths: Object.values(PAYMENT_SECRET_FIELDS).flat(), keyring, rotate, write }));
    reports.push(await processCollection({ label: 'MpesaSettings', model: MpesaSettings, paths: mpesaFields, keyring, rotate, write }));
    reports.push(await processCollection({ label: 'MikroTikConnection', model: MikroTikConnection, paths: ['password'], keyring, rotate, write }));
    reports.push(await processCollection({ label: 'SmsSettings', model: SmsSettings, paths: SMS_SECRET_PATHS, keyring, rotate, write }));

    console.log(JSON.stringify({
      activeKeyId: keyring.activeKeyId,
      mode: write ? (rotate ? 'rotate' : 'write') : 'plan',
      reports,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[secret-encryption] failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSecretPatch,
  encryptedKeyId,
  processCollection,
};

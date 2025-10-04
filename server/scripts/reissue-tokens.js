'use strict';

// Quick token reissue helper.
// Usage examples:
//   node server/scripts/reissue-tokens.js --email user@example.com --tenant 64f...abc
//   node server/scripts/reissue-tokens.js --csv ./pairs.csv   # CSV with header: email,tenantId

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const mongoose = require('mongoose');
const crypto = require('crypto');

const User = require('../models/User');
const Membership = require('../models/Membership');
const RefreshToken = require('../models/RefreshToken');
const { signTenantAccessToken } = require('../utils/jwt');

function refreshExpiry(days = Number(process.env.REFRESH_TTL_DAYS || 30)) {
  return new Date(Date.now() + days * 86400 * 1000);
}

function parseArgs(argv) {
  const args = { cases: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') {
      const email = argv[++i];
      const tenant = argv[i + 1] === '--tenant' ? argv[i + 2] : null;
      if (!tenant) {
        // store partial; tenant read later if provided after
        args._email = email;
      } else {
        i += 2;
        args.cases.push({ email, tenantId: tenant });
      }
    } else if (a === '--tenant') {
      const tenantId = argv[++i];
      if (args._email) {
        args.cases.push({ email: args._email, tenantId });
        delete args._email;
      }
    } else if (a === '--csv') {
      args.csv = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function loadCsvPairs(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  let start = 0;
  const header = lines[0].toLowerCase();
  if (header.includes('email') && header.includes('tenant')) start = 1;
  const pairs = [];
  for (let i = start; i < lines.length; i++) {
    const [email, tenantId] = lines[i].split(',').map((s) => String(s || '').trim());
    if (email && tenantId) pairs.push({ email, tenantId });
  }
  return pairs;
}

async function reissueOne({ email, tenantId }) {
  const user = await User.findOne({ email }).lean();
  if (!user) throw new Error(`User not found: ${email}`);
  const mem = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
  if (!mem) throw new Error(`No membership for tenant ${tenantId} for user ${email}`);

  const accessToken = signTenantAccessToken({ user, tenantId });
  const token = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({ token, user: user._id, tenant: tenantId, expiresAt: refreshExpiry() });

  return {
    email,
    ispId: String(tenantId),
    accessToken,
    refreshToken: token,
  };
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || (!args.csv && args.cases.length === 0)) {
    console.log(`\nUsage:\n  node server/scripts/reissue-tokens.js --email user@example.com --tenant <tenantObjectId>\n  node server/scripts/reissue-tokens.js --csv ./pairs.csv   # CSV with header: email,tenantId\n`);
    process.exit(0);
  }

  const mongo = process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGO_URI is not set');
  await mongoose.connect(mongo, { serverSelectionTimeoutMS: 15000 });

  const all = [...(args.cases || [])];
  if (args.csv) all.push(...loadCsvPairs(args.csv));
  if (all.length === 0) {
    console.error('No cases provided.');
    process.exit(1);
  }

  const out = [];
  for (const c of all) {
    try {
      out.push(await reissueOne(c));
    } catch (e) {
      out.push({ email: c.email, tenantId: c.tenantId, error: e.message });
    }
  }

  console.log(JSON.stringify(out, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});


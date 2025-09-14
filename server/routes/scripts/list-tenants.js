const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');

async function run() {
  const mongo = process.env.MONGO_URI;
  if (!mongo) throw new Error('MONGO_URI is not set');
  await mongoose.connect(mongo, { serverSelectionTimeoutMS: 15000 });
  const tenants = await Tenant.find({}).lean();
  console.log('\nTenants:');
  for (const t of tenants) {
    console.log(`- ${t._id}  ${t.name}`);
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

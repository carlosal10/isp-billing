#!/usr/bin/env node
// server/scripts/reset_mikrotik_entry.js
// Usage: node reset_mikrotik_entry.js <tenantId> <host> [port]

const path = require('path');
const { resetPoolEntry } = require(path.join('..','utils','mikrotikConnectionManager'));

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node reset_mikrotik_entry.js <tenantId> <host> [port]');
    process.exit(1);
  }
  const [tenantId, host, port] = args;
  const ok = resetPoolEntry(tenantId, host, port ? Number(port) : undefined);
  if (ok) {
    console.log('Reset successful for', tenantId, host, port || 8728);
    process.exit(0);
  } else {
    console.error('Reset failed or entry not found for', tenantId, host, port || 8728);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Error:', e && e.message || e);
  process.exit(3);
});

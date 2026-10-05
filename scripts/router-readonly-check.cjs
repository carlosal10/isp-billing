'use strict';
// Credentials arrive over stdin from the local masked prompt, never as arguments.
const { CompatibleRouterOSAPI } = require('../server/utils/routerOsClient');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  let client;
  const report = { checkedAt: new Date().toISOString(), checks: [] };
  const timer = setTimeout(() => { console.log(JSON.stringify({ ...report, error: 'Read-only check timed out' })); process.exit(1); }, 45000);
  try {
    const credentials = JSON.parse(input); input = '';
    client = new CompatibleRouterOSAPI({ host: '192.168.88.1', port: 8728, user: 'billing-test', password: credentials.password, timeout: 8 });
    credentials.password = '';
    client.on('error', () => {});
    await client.connect();
    report.authenticated = true;
    const resources = await client.write('/system/resource/print');
    const r = resources[0] || {};
    report.router = { version: r.version, board: r['board-name'], uptime: r.uptime };
    for (const [name, path] of [['PPP profiles', '/ppp/profile/print'], ['Simple queues', '/queue/simple/print'], ['Hotspot profiles', '/ip/hotspot/user/profile/print'], ['PPP sessions', '/ppp/active/print']]) {
      try {
        // Request identifiers only; never collect subscriber credentials or traffic.
        const rows = await client.write(path, ['=.proplist=.id']);
        report.checks.push({ name, readable: true, count: rows.length });
      } catch { report.checks.push({ name, readable: false }); }
    }
  } catch { report.error = 'Authentication or resource read failed. Check the test account password, API policy and allowed address.'; process.exitCode = 1; }
  finally { clearTimeout(timer); if (client) { try { await client.close(); } catch {} } }
  console.log(JSON.stringify(report, null, 2));
});

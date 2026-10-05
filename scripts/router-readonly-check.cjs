'use strict';
// Credentials arrive over stdin from the local masked prompt, never as arguments.
const { createConnectionManager } = require('../server/utils/mikrotikConnectionManager');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  let client;
  const report = { checkedAt: new Date().toISOString(), checks: [] };
  const timer = setTimeout(() => { console.log(JSON.stringify({ ...report, error: 'Read-only check timed out' })); process.exit(1); }, 45000);
  try {
    const credentials = JSON.parse(input); input = '';
    client = createConnectionManager();
    const config = { id: 'lan-test-router', host: '192.168.88.1', port: 8728, user: 'billing-test', password: credentials.password };
    client.setConfigLoader(async (tenant, selector) => tenant === 'local-readonly-test' && selector.id === config.id ? config : null);
    const context = { tenantId: 'local-readonly-test', serverId: config.id, timeoutMs: 8000 };
    const read = (path, words = []) => client.sendCommand(path, words, context);
    credentials.password = '';
    const resources = await read('/system/resource/print', ['=.proplist=version,board-name,uptime']);
    report.authenticated = true;
    report.transport = 'Application connection manager';
    const r = resources[0] || {};
    report.router = { version: r.version, board: r['board-name'], uptime: r.uptime };
    for (const [name, path] of [['PPP profiles', '/ppp/profile/print'], ['Simple queues', '/queue/simple/print'], ['Hotspot profiles', '/ip/hotspot/user/profile/print'], ['PPP sessions', '/ppp/active/print']]) {
      try {
        // Request identifiers only; never collect subscriber credentials or traffic.
        const rows = await read(path, ['=.proplist=.id']);
        report.checks.push({ name, readable: true, count: rows.length });
      } catch { report.checks.push({ name, readable: false }); }
    }
    // Close only this API connection; no subscriber connections are affected.
    await client.invalidate(context.tenantId, config.id);
    const reconnected = await read('/system/resource/print', ['=.proplist=version']);
    report.checks.push({ name: 'API reconnection', passed: !!reconnected[0]?.version });
    try {
      await client.sendCommand('/system/resource/print', [], { ...context, serverId: 'unconfigured-router' });
      report.checks.push({ name: 'Unknown router rejected', passed: false });
    } catch (error) {
      report.checks.push({ name: 'Unknown router rejected', passed: error.code === 'ROUTER_NOT_FOUND' });
    }
    config.password = '';
  } catch { report.error = 'Authentication or resource read failed. Check the test account password, API policy and allowed address.'; process.exitCode = 1; }
  finally { clearTimeout(timer); if (client) { try { await client.shutdown(); } catch {} } }
  console.log(JSON.stringify(report, null, 2));
});

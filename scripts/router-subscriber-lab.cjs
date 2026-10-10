'use strict';
// Dedicated Tenda subscriber lab. Credentials arrive over stdin and are never reported.
const { createConnectionManager } = require('../server/utils/mikrotikConnectionManager');
const { createPppoeService } = require('../server/services/pppoeService');
const fs = require('node:fs');
const path = require('node:path');
const username = 'billing-lab-tenda';
const assignmentId = 'lab-tenda-pppoe';
const profile = 'billing-lab-tenda-profile';
const marker = 'billing-assignment:' + assignmentId;
const localAddress = '10.254.250.1', remoteAddress = '10.254.250.2';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const report = { checkedAt: new Date().toISOString(), username, profile, localAddress, remoteAddress, checks: [], state: 'running', scope: 'Direct LAN service test; deployed API/outbox not exercised' };
  const manager = createConnectionManager();
  const context = { tenantId: 'subscriber-lab', serverId: 'lan-test-router', timeoutMs: 8000 };
  const call = (command, words = []) => manager.sendCommand(command, words, context);
  const service = createPppoeService((...args) => manager.sendCommand(...args));
  let stage = 'input validation';
  try {
    const credentials = JSON.parse(input); input = '';
    const action = credentials.labAction;
    if (!['provision', 'observe', 'suspend', 'resume', 'release'].includes(action)) throw new Error('Invalid lab action');
    report.action = action;
    const config = { id: context.serverId, host: '192.168.88.1', port: 8728, user: 'billing-test', password: credentials.password };
    credentials.password = '';
    manager.setConfigLoader(async (tenant, selector) => tenant === context.tenantId && selector.id === config.id ? config : null);
    stage = 'authentication';
    await call('/system/resource/print', ['=.proplist=version']);
    stage = 'lab ownership inspection';
    const profiles = await call('/ppp/profile/print', ['?name=' + profile, '=.proplist=.id,name,comment,local-address,remote-address,rate-limit']);
    if (profiles.some(row => row.comment !== marker || row['local-address'] !== localAddress || row['remote-address'] !== remoteAddress)) throw new Error('Lab profile ownership mismatch');
    const accounts = await call('/ppp/secret/print', ['?name=' + username, '=.proplist=.id,name,comment,service,profile,disabled']);
    if (accounts.some(row => row.comment !== marker || row.service !== 'pppoe' || row.profile !== profile)) throw new Error('Lab account ownership mismatch');
    if (action === 'provision') {
      if (typeof credentials.subscriberPassword !== 'string' || credentials.subscriberPassword.length < 8 || credentials.subscriberPassword.length > 128 || /[\x00-\x1f\x7f]/.test(credentials.subscriberPassword)) throw new Error('Invalid subscriber password');
      stage = 'test subnet conflict check';
      const ipNumber = value => value.split('.').reduce((sum, octet) => (sum * 256 + Number(octet)) >>> 0, 0);
      const containsTest = cidr => {
        const [address, bitsText] = String(cidr).split('/');
        const bits = Number(bitsText === undefined ? 32 : bitsText);
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(address) || !Number.isInteger(bits) || bits < 1 || bits > 32) return false;
        const mask = (0xffffffff << (32 - bits)) >>> 0;
        // Reserve the entire dedicated /30, including its network/broadcast addresses.
        return (ipNumber(address) & mask) === (ipNumber(localAddress) & mask) || (ipNumber(address) >>> 2) === (ipNumber(localAddress) >>> 2);
      };
      for (const command of ['/ip/address/print', '/ip/route/print']) {
        const rows = await call(command, ['=.proplist=address,dst-address']);
        if (rows.some(row => containsTest(row.address || row['dst-address']))) throw new Error('Test subnet already routed or assigned');
      }
      for (const row of await call('/ip/pool/print', ['=.proplist=ranges'])) {
        for (const range of String(row.ranges || '').split(',')) {
          if (range.includes('-')) {
            const [start, end] = range.split('-');
            if (ipNumber(start) <= ipNumber('10.254.250.3') && ipNumber(end) >= ipNumber('10.254.250.0')) throw new Error('Test subnet overlaps address pool');
          } else if (containsTest(range)) throw new Error('Test subnet overlaps address pool');
        }
      }
      stage = 'test profile creation';
      if (!profiles.length) await call('/ppp/profile/add', ['=name=' + profile, '=comment=' + marker, '=local-address=' + localAddress, '=remote-address=' + remoteAddress, '=dns-server=1.1.1.1,8.8.8.8', '=rate-limit=2M/2M', '=only-one=yes']);
      stage = 'test account provisioning';
      await service.ensureProvisioned(context, { username, password: credentials.subscriberPassword, profile, assignmentId, enabled: true });
      // A repeated provision preserves the current credential rather than silently rotating it.
      credentials.subscriberPassword = '';
      report.checks.push({ name: 'Test account provisioned', passed: true });
    } else if (action === 'suspend' || action === 'resume') {
      stage = 'test account access change';
      if (accounts.length !== 1) throw new Error('Test account not found');
      await service.setEnabled(context, [username], action === 'resume');
      report.checks.push({ name: action, passed: true });
    } else if (action === 'release') {
      stage = 'test account release';
      await service.remove(context, username, assignmentId);
      for (const row of profiles) await call('/ppp/profile/remove', ['=.id=' + row['.id']]);
      if ((await call('/ppp/profile/print', ['?name=' + profile, '=.proplist=.id'])).length) throw new Error('Test profile remains');
      report.checks.push({ name: 'Test resources released', passed: true });
    }
    stage = 'test session observation';
    const sessions = await call('/ppp/active/print', ['?name=' + username, '=.proplist=name,service,address,uptime']);
    report.sessions = sessions.filter(row => row.name === username).map(row => ({ service: row.service, address: row.address, uptime: row.uptime }));
    report.authenticatedSubscriber = report.sessions.some(row => row.service === 'pppoe' && row.address === remoteAddress);
    if (action === 'observe') {
      report.diagnostics = {};
      const queries = [
        ['queue', '/queue/simple/print', ['?target=' + remoteAddress + '/32'], ['target','max-limit','bytes','packets','disabled']],
        ['subscriberRoute', '/ip/route/print', ['?dst-address=' + remoteAddress + '/32'], ['dst-address','active','gateway','disabled']],
        ['testAccount', '/ppp/secret/print', ['?name=' + username], ['name','profile','disabled']],
      ];
      for (const [key, command, filters, fields] of queries) {
        try {
          report.diagnostics[key] = (await call(command, [...filters, '=.proplist=' + fields.join(',')])).map(row => Object.fromEntries(fields.filter(field => row[field] !== undefined).map(field => [field, row[field]])));
        } catch { report.diagnostics[key] = { error: 'Read unavailable' }; }
      }
      try {
        const replies = await call('/ping', ['=address=1.1.1.1', '=src-address=' + localAddress, '=count=3', '=interval=300ms']);
        report.diagnostics.upstreamFromPppGateway = replies.map(row => Object.fromEntries(['sent','received','packet-loss','status'].filter(field => row[field] !== undefined).map(field => [field, row[field]])));
      } catch { report.diagnostics.upstreamFromPppGateway = { error: 'Probe unavailable; ping may require test permission' }; }
    }
    report.state = 'complete';
  } catch {
    report.state = 'failed'; report.error = 'Failed during ' + stage;
    report.recovery = 'Inspect only the named lab account/profile before retry; partial provisioning is retained for review';
    process.exitCode = 1;
  } finally { await manager.shutdown(); }
  fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../artifacts/router-subscriber-lab-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

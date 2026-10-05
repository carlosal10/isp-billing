'use strict';
const crypto = require('node:crypto');
const { createConnectionManager } = require('../server/utils/mikrotikConnectionManager');
const { createPppoeService } = require('../server/services/pppoeService');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const name = 'billing-test-' + crypto.randomBytes(8).toString('hex');
  const marker = 'billing-assignment:' + name;
  const report = { checkedAt: new Date().toISOString(), testName: name, checks: [], cleanup: 'not needed' };
  const manager = createConnectionManager();
  const context = { tenantId: 'local-write-test', serverId: 'lan-test-router', timeoutMs: 8000 };
  const call = (path, words = []) => manager.sendCommand(path, words, context);
  const service = createPppoeService((...args) => manager.sendCommand(...args));
  let profileAttempted = false, secretAttempted = false;
  let stage = 'authentication';
  const deadline = setTimeout(() => { console.log(JSON.stringify({ ...report, error: 'Test deadline exceeded', cleanup: 'unverified; inspect only objects named ' + name })); process.exit(1); }, 180000);
  try {
    const credentials = JSON.parse(input); input = '';
    const config = { id: context.serverId, host: '192.168.88.1', port: 8728, user: 'billing-test', password: credentials.password };
    credentials.password = '';
    manager.setConfigLoader(async (tenant, selector) => tenant === context.tenantId && selector.id === context.serverId ? config : null);
    await call('/system/resource/print', ['=.proplist=version']);
    report.checks.push({ name: 'Authentication', passed: true });
    stage = 'temporary profile creation';
    if ((await call('/ppp/profile/print', ['?name=' + name])).length || (await call('/ppp/secret/print', ['?name=' + name])).length) throw new Error('Name collision');
    profileAttempted = true;
    await call('/ppp/profile/add', ['=name=' + name, '=comment=' + marker, '=rate-limit=1M/2M']);
    const profiles = await call('/ppp/profile/print', ['?name=' + name, '=.proplist=.id,name,comment,rate-limit']);
    if (profiles.length !== 1 || profiles[0]['rate-limit'] !== '1M/2M') throw new Error('Profile not verified');
    report.checks.push({ name: 'Temporary profile and rate configuration', passed: true });
    stage = 'PPPoE account creation'; secretAttempted = true;
    const options = { assignmentId: name, username: name, password: crypto.randomBytes(32).toString('hex'), profile: name, enabled: false };
    const created = await service.ensureProvisioned(context, options);
    if (!created.disabled) throw new Error('Account not disabled');
    report.checks.push({ name: 'Create disabled PPPoE account', passed: true });
    stage = 'idempotent retry';
    const repeated = await service.ensureProvisioned(context, options);
    if (repeated.id !== created.id) throw new Error('Retry created a different account');
    report.checks.push({ name: 'Retry reuses the same account', passed: true });
    // Random credentials stay in memory and are never used by a subscriber.
    stage = 'enable and suspend';
    await service.setEnabled(context, [name], true);
    await service.setEnabled(context, [name], false);
    report.checks.push({ name: 'Enable and suspend temporary account', passed: true });
    stage = 'account release';
    await service.remove(context, name, name);
    await service.remove(context, name, name);
    report.checks.push({ name: 'Release and repeat release', passed: true });
  } catch {
    report.error = 'Failed during ' + stage + '. Check account permissions and router connectivity.';
    process.exitCode = 1;
  } finally {
    try {
      if (secretAttempted) await service.remove(context, name, name);
      if (profileAttempted) {
        const profiles = await call('/ppp/profile/print', ['?name=' + name, '=.proplist=.id,name,comment']);
        for (const profile of profiles) {
          if (profile.name !== name || profile.comment !== marker || !profile['.id']) throw new Error('Ownership mismatch');
          await call('/ppp/profile/remove', ['=.id=' + profile['.id']]);
        }
        if ((await call('/ppp/profile/print', ['?name=' + name])).length) throw new Error('Profile remains');
      }
      report.cleanup = 'verified';
    } catch { report.cleanup = 'unverified; inspect only objects named ' + name; process.exitCode = 1; }
    await manager.shutdown(); clearTimeout(deadline);
  }
  console.log(JSON.stringify(report, null, 2));
});

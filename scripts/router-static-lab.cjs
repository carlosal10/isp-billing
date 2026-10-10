'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createConnectionManager } = require('../server/utils/mikrotikConnectionManager');
const { createStaticProvisioner } = require('../server/services/staticProvisioningService');
const id = 'lab-tenda-static', gateway = '10.254.251.1', ipAddress = '10.254.251.2';
const marker = 'billing-lab-static-gateway';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const report = { checkedAt: new Date().toISOString(), state: 'running', ipAddress, gateway, subnetMask: '255.255.255.252', checks: [], scope: 'Direct LAN service test; deployed API/outbox not exercised' };
  const manager = createConnectionManager();
  const context = { tenantId: 'subscriber-lab', serverId: 'lan-test-router', timeoutMs: 8000 };
  const call = (command, words = []) => manager.sendCommand(command, words, context);
  let stage = 'input validation';
  try {
    const credentials = JSON.parse(input); input = '';
    const action = credentials.labAction; report.action = action;
    if (!['provision', 'observe', 'suspend', 'resume', 'release'].includes(action)) throw new Error('Invalid action');
    const config = { id: context.serverId, host: '192.168.88.1', port: 8728, user: 'billing-test', password: credentials.password };
    credentials.password = '';
    manager.setConfigLoader(async (tenant, selector) => tenant === context.tenantId && selector.id === config.id ? config : null);
    stage = 'authentication';
    await call('/system/resource/print', ['=.proplist=version']);
    stage = 'gateway ownership inspection';
    const gateways = await call('/ip/address/print', ['?comment=' + marker, '=.proplist=.id,address,interface,comment']);
    if (gateways.length > 1 || gateways.some(row => row.address !== gateway + '/30' || row.interface !== 'bridge')) throw new Error('Gateway differs from lab');
    if (action === 'provision') {
      stage = 'test subnet conflict check';
      const ipNumber = value => value.split('.').reduce((sum, octet) => (sum * 256 + Number(octet)) >>> 0, 0);
      const overlaps = cidr => {
        const [address, bitText] = String(cidr).split('/');
        const bits = Number(bitText === undefined ? 32 : bitText);
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(address) || !Number.isInteger(bits) || bits < 1 || bits > 32) return false;
        const mask = (0xffffffff << (32 - bits)) >>> 0;
        return (ipNumber(address) & mask) === (ipNumber(gateway) & mask) || (ipNumber(address) >>> 2) === (ipNumber(gateway) >>> 2);
      };
      if (!gateways.length) {
        for (const command of ['/ip/address/print', '/ip/route/print']) {
          if ((await call(command, ['=.proplist=address,dst-address'])).some(row => overlaps(row.address || row['dst-address']))) throw new Error('Test subnet already assigned or routed');
        }
        for (const row of await call('/ip/pool/print', ['=.proplist=ranges'])) {
          for (const range of String(row.ranges || '').split(',')) {
            if (range.includes('-')) {
              const [start, end] = range.split('-');
              if (ipNumber(start) <= ipNumber('10.254.251.3') && ipNumber(end) >= ipNumber('10.254.251.0')) throw new Error('Test subnet overlaps pool');
            } else if (overlaps(range)) throw new Error('Test subnet overlaps pool');
          }
        }
        const port = await call('/interface/bridge/port/print', ['?interface=ether3', '=.proplist=bridge,disabled']);
        if (port.length !== 1 || port[0].bridge !== 'bridge' || ['true', 'yes'].includes(port[0].disabled)) throw new Error('Test port topology changed');
        stage = 'lab gateway addition';
        await call('/ip/address/add', ['=address=' + gateway + '/30', '=interface=bridge', '=comment=' + marker]);
      }
    }
    if (['provision', 'suspend', 'resume', 'release'].includes(action)) {
      if (action !== 'provision' && action !== 'release' && gateways.length !== 1) throw new Error('Lab gateway missing');
      stage = 'static service ' + action;
      const state = action === 'release' ? 'absent' : action === 'suspend' ? 'suspended' : 'present';
      report.service = await createStaticProvisioner((...args) => manager.sendCommand(...args))({ _id: id, tenantId: context.tenantId, routerId: context.serverId, ipAddress, desiredState: state });
      if (action === 'provision') {
        const queue = (await call('/queue/simple/print', ['?name=billing-' + id, '=.proplist=.id,comment,target']))[0];
        if (!queue || queue.comment !== 'Billing assignment ' + id || String(queue.target).replace('/32', '') !== ipAddress) throw new Error('Lab queue mismatch');
        await call('/queue/simple/set', ['=.id=' + queue['.id'], '=max-limit=2M/2M']);
      }
      if (action === 'release') {
        for (const row of gateways) await call('/ip/address/remove', ['=.id=' + row['.id']]);
        if ((await call('/ip/address/print', ['?comment=' + marker, '=.proplist=.id'])).length) throw new Error('Gateway remains');
      }
      report.checks.push({ name: action, passed: true });
    }
    stage = 'queue observation';
    report.queues = await call('/queue/simple/print', ['?name=billing-' + id, '=.proplist=name,target,max-limit,bytes,packets,disabled']);
    const fasttrack = await call('/ip/firewall/filter/print', ['?action=fasttrack-connection', '=.proplist=disabled']);
    report.activeFasttrackRules = fasttrack.filter(row => !['true', 'yes'].includes(row.disabled)).length;
    report.state = 'complete';
  } catch {
    report.state = 'failed'; report.error = 'Failed during ' + stage;
    report.recovery = 'Inspect only gateway comment ' + marker + ' and queue billing-' + id + '; partial lab resources remain for review';
    process.exitCode = 1;
  } finally { await manager.shutdown(); }
  fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../artifacts/router-static-lab-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

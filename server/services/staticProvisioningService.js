'use strict';
const { isIP } = require('node:net');
const manager = require('../utils/mikrotikConnectionManager');
const fail = message => Object.assign(new Error(message), { statusCode: 409 });
const yes = value => ['true', 'yes', '1'].includes(String(value));
function createStaticProvisioner(send = (...args) => manager.sendCommand(...args)) {
  return async a => {
    if (isIP(a.ipAddress) !== 4) throw fail('Static assignment requires a single IPv4 address.');
    const context = { tenantId: String(a.tenantId), serverId: String(a.routerId), timeoutMs: 8000, retryCount: 0 };
    const call = (path, words = []) => send(path, words, context);
    const name = 'billing-' + a._id, comment = 'Billing assignment ' + a._id;
    const target = a.ipAddress + '/32', absent = a.desiredState === 'absent' || a.status === 'released';
    const queues = await call('/queue/simple/print', ['?name=' + name]);
    if (queues.some(q => q.name !== name || q.comment !== comment || String(q.target).replace('/32', '') !== a.ipAddress)) throw fail('Managed queue ownership or target differs from this assignment.');
    // Billing rules are independent of FUP rules; resuming billing cannot remove a FUP block.
    const blocked = !absent && a.desiredState === 'suspended';
    for (const direction of ['src', 'dst']) {
      const marker = 'billing-access-' + a._id + '-' + direction;
      let found = await call('/ip/firewall/filter/print', ['?comment=' + marker]);
      if (blocked) {
        if (!found.length) await call('/ip/firewall/filter/add', ['=chain=forward', '=action=drop', '=' + direction + '-address=' + a.ipAddress, '=comment=' + marker]);
        found = await call('/ip/firewall/filter/print', ['?comment=' + marker]);
        if (found.length !== 1 || !found[0]['.id']) throw fail('Subscriber block rule was not created.');
        const id = found[0]['.id'];
        await call('/ip/firewall/filter/set', ['=.id=' + id, '=chain=forward', '=action=drop', '=disabled=no', '=' + direction + '-address=' + a.ipAddress]);
        await call('/ip/firewall/filter/move', ['=numbers=' + id, '=destination=0']);
        const checked = (await call('/ip/firewall/filter/print', ['?comment=' + marker]))[0];
        if (!checked || yes(checked.disabled) || checked.chain !== 'forward' || checked.action !== 'drop' || String(checked[direction + '-address']).replace('/32', '') !== a.ipAddress) throw fail('Subscriber block rule was not verified.');
      } else {
        for (const rule of found) if (rule.comment === marker && rule['.id']) await call('/ip/firewall/filter/remove', ['=.id=' + rule['.id']]);
        if ((await call('/ip/firewall/filter/print', ['?comment=' + marker])).length) throw fail('Subscriber block removal was not verified.');
      }
    }
    if (blocked) {
      for (const row of await call('/ip/firewall/connection/print', [])) {
        if (['src-address', 'dst-address'].some(k => String(row[k] || '').split(':')[0] === a.ipAddress) && row['.id']) await call('/ip/firewall/connection/remove', ['=.id=' + row['.id']]);
      }
    }
    if (absent) {
      for (const queue of queues) await call('/queue/simple/remove', ['=.id=' + queue['.id']]);
      // Release removes only this assignment's FUP rules as well.
      for (const direction of ['src', 'dst']) {
        const marker = 'billing-fup-' + a._id + '-' + direction;
        for (const rule of await call('/ip/firewall/filter/print', ['?comment=' + marker])) if (rule.comment === marker && rule['.id']) await call('/ip/firewall/filter/remove', ['=.id=' + rule['.id']]);
        if ((await call('/ip/firewall/filter/print', ['?comment=' + marker])).length) throw fail('Released FUP block remains on router.');
      }
      if ((await call('/queue/simple/print', ['?name=' + name])).length) throw fail('Queue removal was not verified.');
      return { state: 'absent', verified: true };
    }
    if (!queues.length) await call('/queue/simple/add', ['=name=' + name, '=target=' + target, '=comment=' + comment]);
    const verified = (await call('/queue/simple/print', ['?name=' + name]))[0];
    if (!verified || verified.comment !== comment || String(verified.target).replace('/32', '') !== a.ipAddress) throw fail('Static queue was not verified.');
    return { state: blocked ? 'suspended' : 'present', queueName: name, target, verified: true };
  };
}
module.exports = { createStaticProvisioner };

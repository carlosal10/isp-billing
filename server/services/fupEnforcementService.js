'use strict';
const { isIP } = require('node:net');
const { routerRate } = require('./fupRules');
const manager = require('../utils/mikrotikConnectionManager');
const Assignment = require('../models/NetworkAssignment');
const Radius = require('../models/RadiusServer');
const fail = message => Object.assign(new Error(message), { fupSafe: true });
const w = (key, value) => '=' + key + '=' + value;
const q = (key, value) => '?' + key + '=' + value;
const yes = value => ['true', 'yes', '1'].includes(String(value));
function rateValue(value) {
  return String(value).replace(/(\d+)([kKmM])/g, (_, n, unit) => String(BigInt(n) * (unit.toLowerCase() === 'm' ? 1000000n : 1000n)));
}
function createFupEnforcer({ send = (...args) => manager.sendCommand(...args),
  saveBaseline = async (a, baseline) => {
    await Assignment.updateOne({ _id: a._id, tenantId: a.tenantId, 'fup.baseline': null }, { $set: { 'fup.baseline': baseline } });
    const saved = await Assignment.findOne({ _id: a._id, tenantId: a.tenantId }).lean();
    return saved.fup.baseline;
  }, loadRadius = id => Radius.findById(id).lean() } = {}) {
  return async function enforce(assignment, operation) {
    const a = assignment, target = operation.desiredState?.fupState;
    if (!['normal', 'throttled', 'blocked'].includes(target)) throw fail('Invalid FUP target');
    if (a.status === 'released' || a.desiredState === 'absent') return { superseded: true };
    const context = { tenantId: String(a.tenantId), serverId: String(a.routerId), timeoutMs: 8000, retryCount: 0 };
    const call = (path, words = []) => send(path, words, context);
    async function rows(path, words) {
      const result = await call(path + '/print', words);
      if (!Array.isArray(result)) throw fail('Invalid router response');
      return result;
    }
    const rate = target === 'throttled' ? routerRate(operation.desiredState.uploadRate, operation.desiredState.downloadRate) : null;
    if (rate && !/^[1-9]\d*[kKM]?\/[1-9]\d*[kKM]?$/.test(rate)) throw fail('Invalid throttle rate');
    const marker = 'billing-fup-' + a._id;
    async function disconnect(base, field) {
      for (const session of await rows(base, [q(field, a.username)])) {
        if (session[field] === a.username && session['.id']) await call(base + '/remove', [w('.id', session['.id'])]);
      }
      if ((await rows(base, [q(field, a.username)])).some(s => s[field] === a.username)) throw fail('Session disconnect was not confirmed');
    }
    if (a.authenticationMode === 'radius' && a.accessType !== 'static') {
      const radius = await loadRadius(a.radiusServerId);
      if (!radius || String(radius.tenantId) !== String(a.tenantId) || !radius.enabled || radius.fupIntegration !== 'rest') {
        throw fail('Configure the RADIUS FUP authorization integration before enforcement');
      }
      if (operation.desiredState.radiusAcknowledged !== true) throw fail('Waiting for RADIUS policy acknowledgment');
      await disconnect(a.accessType === 'pppoe' ? '/ppp/active' : '/ip/hotspot/active', a.accessType === 'pppoe' ? 'name' : 'user');
      return { fupState: target, verified: true, delivery: 'radius-policy-and-reauthentication' };
    }
    if (a.accessType === 'static') {
      if (isIP(a.ipAddress) !== 4) throw fail('Static FUP requires a single IPv4 assignment');
      const name = 'billing-' + a._id;
      const queue = (await rows('/queue/simple', [q('name', name)])).find(r => r.name === name);
      if (!queue?.['.id']) throw fail('Managed subscriber queue is missing');
      if (String(queue.target).replace('/32', '') !== a.ipAddress) throw fail('Queue target differs from assigned IP');
      let baseline = a.fup?.baseline;
      if (!baseline && target === 'normal') return { fupState: 'normal', verified: true };
      if (!baseline) baseline = await saveBaseline(a, { kind: 'static', rate: queue['max-limit'] || '0/0', target: queue.target });
      if (baseline.kind !== 'static' || baseline.target !== queue.target) throw fail('FUP baseline no longer matches assignment');
      // Dedicated drop rules precede fasttrack and established-connection rules.
      for (const direction of ['src', 'dst']) {
        const comment = marker + '-' + direction;
        const found = (await rows('/ip/firewall/filter', [q('comment', comment)])).filter(r => r.comment === comment);
        if (target === 'blocked') {
          if (!found.length) await call('/ip/firewall/filter/add', [w('chain', 'forward'), w('action', 'drop'), w(direction + '-address', a.ipAddress), w('comment', comment)]);
          const installed = (await rows('/ip/firewall/filter', [q('comment', comment)])).find(r => r.comment === comment);
          if (!installed?.['.id']) throw fail('Block rule not created');
          await call('/ip/firewall/filter/set', [w('.id', installed['.id']), w('disabled', 'no'), w('chain', 'forward'), w('action', 'drop'), w(direction + '-address', a.ipAddress)]);
          await call('/ip/firewall/filter/move', [w('numbers', installed['.id']), w('destination', '0')]);
          const checked = (await rows('/ip/firewall/filter', [q('comment', comment)])).find(r => r.comment === comment);
          if (!checked || yes(checked.disabled) || checked.action !== 'drop' || checked.chain !== 'forward' || checked[direction + '-address'].replace('/32', '') !== a.ipAddress) throw fail('Block rule not verified');
        } else {
          for (const item of found) await call('/ip/firewall/filter/remove', [w('.id', item['.id'])]);
          if ((await rows('/ip/firewall/filter', [q('comment', comment)])).length) throw fail('Block removal not verified');
        }
      }
      const desiredRate = rate || baseline.rate;
      if (target === 'throttled') {
        const fasttrack = await rows('/ip/firewall/filter', ['?action=fasttrack-connection']);
        if (fasttrack.some(r => !yes(r.disabled))) throw fail('Exclude managed subscribers from FastTrack before static FUP enforcement');
      }
      await call('/queue/simple/set', [w('.id', queue['.id']), w('max-limit', desiredRate)]);
      await call('/queue/simple/move', [w('numbers', queue['.id']), w('destination', '0')]);
      const verified = (await rows('/queue/simple', [q('name', name)])).find(r => r.name === name);
      if (!verified || rateValue(verified['max-limit']) !== rateValue(desiredRate)) throw fail('Static rate was not verified');
      // Flush only this subscriber's tracked flows so existing fasttracked flows cannot bypass a block.
      if (target === 'blocked') {
        for (const field of ['src-address', 'dst-address']) {
          const connections = await rows('/ip/firewall/connection', []);
          for (const c of connections) if (String(c[field] || '').split(':')[0] === a.ipAddress) await call('/ip/firewall/connection/remove', [w('.id', c['.id'])]);
        }
      }
      return { fupState: target, verified: true };
    }
    if (!a.username) throw fail('Assignment has no username');
    const ppp = a.accessType === 'pppoe';
    const userPath = ppp ? '/ppp/secret' : '/ip/hotspot/user';
    const profilePath = ppp ? '/ppp/profile' : '/ip/hotspot/user/profile';
    const user = (await rows(userPath, [q('name', a.username)])).find(r => r.name === a.username);
    if (!user?.['.id']) throw fail('Subscriber user not found');
    let baseline = a.fup?.baseline;
    if (!baseline && target === 'normal') return { fupState: 'normal', verified: true };
    if (!baseline) baseline = await saveBaseline(a, { kind: a.accessType, profile: user.profile || 'default', disabled: yes(user.disabled), username: a.username });
    if (baseline.kind !== a.accessType || baseline.username !== a.username) throw fail('FUP baseline differs from subscriber');
    let profile = baseline.profile;
    if (target === 'throttled') {
      const original = (await rows(profilePath, [q('name', baseline.profile)])).find(r => r.name === baseline.profile);
      if (!original?.['.id']) throw fail('Original profile is missing');
      let managed = (await rows(profilePath, [q('name', marker)])).find(r => r.name === marker);
      if (!managed) {
        await call(profilePath + '/add', [w('copy-from', original['.id']), w('name', marker), w('rate-limit', rate)]);
      } else {
        await call(profilePath + '/set', [w('.id', managed['.id']), w('rate-limit', rate)]);
      }
      managed = (await rows(profilePath, [q('name', marker)])).find(r => r.name === marker);
      if (!managed || rateValue(managed['rate-limit']) !== rateValue(rate)) throw fail('Throttle profile rate not verified');
      profile = marker;
    }
    const disabled = target === 'blocked' || a.desiredState !== 'present' || baseline.disabled;
    await call(userPath + '/set', [w('.id', user['.id']), w('profile', profile), w('disabled', disabled ? 'yes' : 'no')]);
    const verified = (await rows(userPath, [q('name', a.username)])).find(r => r.name === a.username);
    if (!verified || verified.profile !== profile || yes(verified.disabled) !== disabled) throw fail('Subscriber policy not verified');
    // Profile changes apply at login. Remove active sessions after persisting the next-login policy.
    await disconnect(ppp ? '/ppp/active' : '/ip/hotspot/active', ppp ? 'name' : 'user');
    return { fupState: target, verified: true, profile };
  };
}
module.exports = { createFupEnforcer, rateValue };

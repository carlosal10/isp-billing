'use strict';
const manager = require('../utils/mikrotikConnectionManager');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const publicSecret = row => ({ id: row['.id'], name: row.name, profile: row.profile,
  service: row.service, disabled: row.disabled === 'true' || row.disabled === 'yes' || row.disabled === true });

function createPppoeService(send = (...args) => manager.sendCommand(...args)) {
  const call = (context, path, words = []) => send(path, words, { ...context, timeoutMs: 10000, retryCount: 1 });
  async function find(context, username) {
    const rows = await call(context, '/ppp/secret/print', ['?name=' + username]);
    const row = rows.find(r => r.name === username && ['pppoe', 'any', undefined].includes(r.service));
    if (!row?.['.id']) throw fail(404, 'PPPoE user not found on the selected router.');
    return row;
  }
  async function disconnect(context, username) {
    const sessions = await call(context, '/ppp/active/print', ['?name=' + username]);
    for (const session of sessions) {
      if (session.name === username && session['.id']) await call(context, '/ppp/active/remove', ['=.id=' + session['.id']]);
    }
  }
  return {
    async ensureProvisioned(context, { username, password, profile, assignmentId, enabled }) {
      const marker = 'billing-assignment:' + assignmentId;
      let rows = await call(context, '/ppp/secret/print', ['?name=' + username]);
      const creating = !rows.length;
      if (rows.length && (rows.length !== 1 || rows[0].comment !== marker || rows[0].service !== 'pppoe')) {
        throw fail(409, 'Username belongs to another router account. Choose a new username.');
      }
      if (!rows.length) {
        if (!password || !profile) throw fail(400, 'PPPoE provisioning requires a password and profile.');
        const profiles = await call(context, '/ppp/profile/print', ['?name=' + profile]);
        if (!profiles.some(p => p.name === profile)) throw fail(400, 'Selected PPP profile does not exist.');
        await call(context, '/ppp/secret/add', ['=name=' + username, '=password=' + password, '=service=pppoe', '=profile=' + profile, '=comment=' + marker, '=disabled=' + (enabled ? 'no' : 'yes')]);
        rows = await call(context, '/ppp/secret/print', ['?name=' + username]);
      }
      const row = rows[0];
      if (!row?.['.id'] || row.comment !== marker || row.service !== 'pppoe' || (creating && row.profile !== profile)) throw fail(502, 'Router did not confirm the requested PPPoE account.');
      // A retry may recover an add that succeeded before the connection dropped.
      return publicSecret(row);
    },
    async profiles(context) {
      const rows = await call(context, '/ppp/profile/print');
      return rows.map(p => ({ id: p['.id'], name: p.name, localAddress: p['local-address'] || '', rateLimit: p['rate-limit'] || '' }));
    },
    async list(context) { return (await call(context, '/ppp/secret/print')).filter(r => ['pppoe', 'any', undefined].includes(r.service)).map(publicSecret); },
    async online(context) { return (await call(context, '/ppp/active/print', ['?service=pppoe'])).map(r => ({ id: r['.id'], name: r.name, address: r.address, uptime: r.uptime, callerId: r['caller-id'] })); },
    async add(context, { username, password, profile }) {
      const existing = await call(context, '/ppp/secret/print', ['?name=' + username]);
      if (existing.length) throw fail(409, 'This username already exists on the selected router.');
      const profiles = await call(context, '/ppp/profile/print', ['?name=' + profile]);
      if (!profiles.some(p => p.name === profile)) throw fail(400, 'The selected PPP profile no longer exists. Reload profiles.');
      await call(context, '/ppp/secret/add', ['=name=' + username, '=password=' + password, '=service=pppoe', '=profile=' + profile]);
      return publicSecret(await find(context, username));
    },
    async password(context, username, password) {
      const row = await find(context, username);
      await call(context, '/ppp/secret/set', ['=.id=' + row['.id'], '=password=' + password]);
      // RouterOS never returns secret passwords from /ppp/secret/print. A
      // successful re-read confirms that the secret still exists; the new
      // password is intentionally never echoed or compared locally.
      await find(context, username);
    },
    async remove(context, username, assignmentId) {
      let row;
      try { row = await find(context, username); }
      catch (error) { if (assignmentId && error.statusCode === 404) return; throw error; }
      if (assignmentId && row.comment !== 'billing-assignment:' + assignmentId) throw fail(409, 'Router account ownership changed; removal refused.');
      await call(context, '/ppp/secret/set', ['=.id=' + row['.id'], '=disabled=yes']);
      await disconnect(context, username);
      await call(context, '/ppp/secret/remove', ['=.id=' + row['.id']]);
      if ((await call(context, '/ppp/secret/print', ['?name=' + username])).length) throw fail(502, 'The router still reports this user.');
    },
    async setEnabled(context, candidates, enabled) {
      let row;
      for (const username of [...new Set(candidates.filter(Boolean))]) {
        try { row = await find(context, username); break; } catch (error) { if (error.statusCode !== 404) throw error; }
      }
      if (!row) throw fail(404, 'No local PPPoE secret matches this customer on the selected router.');
      await call(context, '/ppp/secret/set', ['=.id=' + row['.id'], '=disabled=' + (enabled ? 'no' : 'yes')]);
      if (!enabled) await disconnect(context, row.name);
      const observed = publicSecret(await find(context, row.name));
      if (observed.disabled === enabled) throw fail(502, 'PPPoE access state was not confirmed by the router.');
      return { enabled, username: row.name, verified: true };
    },
  };
}
module.exports = { ...createPppoeService(), createPppoeService };

'use strict';
const manager = require('../utils/mikrotikConnectionManager');
const fail = message => Object.assign(new Error(message), { statusCode: 409 });
const yes = value => ['yes', 'true', '1'].includes(String(value));
function createHotspotProvisioner(send = (...args) => manager.sendCommand(...args)) {
  return async (a, password) => {
    const context = { tenantId: String(a.tenantId), serverId: String(a.routerId), timeoutMs: 8000, retryCount: 0 };
    const call = (path, words = []) => send(path, words, context);
    const userPath = '/ip/hotspot/user';
    const marker = 'billing-assignment:' + a._id;
    const username = a.username;
    if (!username) throw fail('Hotspot assignment has no username.');
    const read = async () => (await call(userPath + '/print', ['?name=' + username])).filter(r => r.name === username);
    const absent = a.desiredState === 'absent' || a.status === 'released';
    let rows = await read();
    if (rows.length > 1 || rows.some(r => r.comment !== marker)) throw fail('Hotspot username belongs to another account.');
    if (!rows.length && absent) return { state: 'absent', verified: true };
    if (!rows.length) {
      if (!password || !a.hotspotProfile) throw fail('Hotspot creation requires a password and profile.');
      const profiles = await call(userPath + '/profile/print', ['?name=' + a.hotspotProfile]);
      if (!profiles.some(p => p.name === a.hotspotProfile)) throw fail('Selected hotspot profile does not exist.');
      await call(userPath + '/add', ['=name=' + username, '=password=' + password, '=profile=' + a.hotspotProfile, '=comment=' + marker, '=disabled=yes', ...(a.macAddress ? ['=mac-address=' + a.macAddress] : [])]);
      rows = await read();
      if (rows[0]?.profile !== a.hotspotProfile) throw fail('Hotspot profile was not verified.');
    }
    const user = rows[0];
    if (!user?.['.id'] || user.comment !== marker) throw fail('Hotspot ownership was not verified.');
    const disabled = absent || a.desiredState === 'suspended' || a.fup?.desired === 'blocked';
    await call(userPath + '/set', ['=.id=' + user['.id'], '=disabled=' + (disabled ? 'yes' : 'no')]);
    if (disabled) {
      for (const session of await call('/ip/hotspot/active/print', ['?user=' + username])) {
        if (session.user === username && session['.id']) await call('/ip/hotspot/active/remove', ['=.id=' + session['.id']]);
      }
      // Remove remembered logins for this subscriber when suspending or releasing.
      for (const cookie of await call('/ip/hotspot/cookie/print', ['?user=' + username])) {
        if (cookie.user === username && cookie['.id']) await call('/ip/hotspot/cookie/remove', ['=.id=' + cookie['.id']]);
      }
      if ((await call('/ip/hotspot/active/print', ['?user=' + username])).some(s => s.user === username)) throw fail('Hotspot session disconnect was not verified.');
    }
    if (absent) {
      await call(userPath + '/remove', ['=.id=' + user['.id']]);
      if ((await read()).length) throw fail('Hotspot removal was not verified.');
      return { state: 'absent', verified: true };
    }
    const verified = (await read())[0];
    if (!verified || yes(verified.disabled) !== disabled) throw fail('Hotspot access state was not verified.');
    return { state: disabled ? 'suspended' : 'present', verified: true };
  };
}
module.exports = { createHotspotProvisioner };

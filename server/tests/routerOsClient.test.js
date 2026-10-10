'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CompatibleRouterOSAPI } = require('../utils/routerOsClient');
const { Receiver } = require('node-routeros/dist/connector/Receiver');

test('empty replies keep their receiver registered until done, including consecutive commands', async () => {
  const receiver = new Receiver({});
  const client = new CompatibleRouterOSAPI({ host: '127.0.0.1', user: 'test', password: '' });
  client.connector = {
    read: (tag, callback) => receiver.read(tag, callback),
    stopRead: tag => receiver.stop(tag),
    write: () => {},
  };
  for (let index = 0; index < 2; index++) {
    const channel = client.openChannel();
    let completed = false;
    const result = channel.write(['/ppp/secret/print']).then(rows => { completed = true; return rows; });
    const reply = packet => {
      receiver.currentPacket = packet;
      receiver.sendTagData(channel.Id);
    };
    reply(['!empty']);
    await Promise.resolve();
    assert.equal(completed, false, 'empty alone must not confirm completion');
    assert.equal(receiver.tags.has(channel.Id), true);
    reply(['!done']);
    assert.deepEqual(await result, []);
    assert.equal(receiver.tags.has(channel.Id), false);
  }
});

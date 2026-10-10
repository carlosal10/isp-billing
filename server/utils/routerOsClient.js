'use strict';
const { RouterOSAPI } = require('routeros-client');
// node-routeros 1.x predates RouterOS 7.18's !empty reply. Adapt only
// this client's channels; wait for !done and reject unknown replies locally.
class CompatibleRouterOSAPI extends RouterOSAPI {
  openChannel() {
    const channel = super.openChannel();
    const processPacket = channel.processPacket.bind(channel);
    channel.processPacket = (packet) => {
      // !empty is a data reply, not command completion. Removing the reader
      // here makes the subsequent !done crash node-routeros with UNREGISTEREDTAG.
      if (packet[0] === '!empty') return;
      if (!['!re', '!done', '!trap'].includes(packet[0])) {
        channel.emit('trap', { message: 'Unsupported RouterOS reply' });
        channel.close();
        return;
      }
      return processPacket(packet);
    };
    return channel;
  }
}
module.exports = { CompatibleRouterOSAPI };

// utils/getMac.js
function getMAC(req) {
  const mac = req.headers['x-mac-address'] || req.query.mac;
  if (!mac) throw new Error('MAC address not found');
  return mac;
}

module.exports = { getMAC };

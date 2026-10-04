'use strict';
const net = require('node:net');
function validRouterHost(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 253) return false;
  if (net.isIP(value)) return true;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value) && !/^\d+(?:\.\d+)+$/.test(value);
}
function connectionDiagnostic(error) {
  const text = `${error?.code || ''} ${error?.message || error || ''}`;
  if (/CONFIG_CHANGED/.test(text)) return { code: 'configuration', message: 'Router settings changed. Run the operation again using the saved settings.' };
  if (/ROUTER_NOT_FOUND|config not found/.test(text)) return { code: 'not-found', message: 'The selected router is unavailable in this workspace. Select a saved router.' };
  if (/username|password|authentication|login failure|invalid user|CANTLOGIN/i.test(text)) return { code: 'auth', message: 'Router authentication failed. Check the API username, password and permissions.' };
  if (/certificate|CERT_|TLS|SSL|SELF_SIGNED/i.test(text)) return { code: 'tls', message: 'TLS verification failed. Use API-SSL with a trusted certificate matching the router hostname.' };
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(text)) return { code: 'dns', message: 'The billing server could not resolve this hostname. Check DNS or use the router tunnel address.' };
  if (/ECONNREFUSED|refused/i.test(text)) return { code: 'refused', message: 'The connection was refused. Check the API service, port and firewall rules for the billing server.' };
  if (/QUEUE|busy/i.test(text)) return { code: 'busy', message: 'The router has pending operations. Wait for them to finish and retry.' };
  if (/timeout|TIMEDOUT|EHOST|ENET|ECONN|closed/i.test(text)) return { code: 'unreachable', message: 'The billing server could not reach the router. For a private or CGNAT address, establish a VPN route from the server to the router. Cloud/DDNS alone does not create this route.' };
  return { code: 'router-error', message: 'The router did not complete the operation. Check API permissions, router configuration and the selected profile.' };
}
module.exports = { validRouterHost, connectionDiagnostic };

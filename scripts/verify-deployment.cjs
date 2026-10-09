'use strict';

// Public, read-only checks. No login or router credentials are required.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const client = new URL(process.env.DEPLOY_CLIENT_URL || 'https://isp-billing-is9m.onrender.com');
const api = new URL(process.env.DEPLOY_API_URL || 'https://isp-billing-server.onrender.com');
const expected = process.env.EXPECTED_DEPLOYMENT_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/i.test(expected)) throw new Error('Expected a full commit identifier');
for (const url of [client, api]) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) service URL without credentials');
}
const report = { checkedAt: new Date().toISOString(), expectedRevision: expected.toLowerCase(), checks: [], liveRouterAcceptance: 'not tested' };
const check = (name, passed, detail) => report.checks.push({ name, passed, detail });
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
async function probe(name, work) {
  try { await work(); } catch (error) { check(name, false, error.message); }
}
async function main() {
  await probe('Frontend bundle', async () => {
    const html = await (await request(new URL('/login', client))).text();
    const assets = text => [...text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(match => match[1]).sort();
    const deployed = assets(html);
    const local = assets(fs.readFileSync(path.join(root, 'build/index.html'), 'utf8'));
    if (!local.length || JSON.stringify(deployed) !== JSON.stringify(local)) throw new Error('Deployed assets differ from the local production build');
    for (const asset of deployed) {
      const url = new URL(asset, client);
      if (url.origin !== client.origin) throw new Error('Unexpected external build asset');
      const response = await request(url);
      if ((response.headers.get('content-type') || '').includes('text/html')) throw new Error('An asset returned the HTML fallback');
      // Compare bytes as well as names; stale CDN content must fail the check.
      const localPath = path.resolve(root, 'build', '.' + url.pathname);
      if (!localPath.startsWith(path.join(root, 'build') + path.sep)) throw new Error('Unexpected asset path');
      if (!Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(localPath))) throw new Error('Deployed asset content differs from local build');
    }
    check('Frontend bundle', true, 'All JavaScript and CSS assets match the local production build');
  });
  for (const endpoint of ['/health', '/ready']) {
    await probe(endpoint, async () => {
      const response = await request(new URL(endpoint, api), { headers: { Origin: client.origin } });
      const payload = await response.json();
      if (payload.ok !== true || payload.service !== 'isp-billing-api') throw new Error('Unexpected health response');
      if (payload.revision !== expected.toLowerCase()) throw new Error('Backend commit is missing or differs from the expected revision');
      if (response.headers.get('access-control-allow-origin') !== client.origin) throw new Error('API does not allow the frontend origin');
      check(endpoint, true, 'Expected API commit, healthy response and frontend origin allowed');
    });
  }
  report.passed = report.checks.every(item => item.passed);
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/deployment-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
main().catch(() => { console.error('Deployment verification could not complete'); process.exitCode = 1; });

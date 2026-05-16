#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  auditApiContract,
} = require('../services/apiContractService');

const rootDir = path.resolve(__dirname, '..', '..');
const openApiPath = path.join(rootDir, 'docs', 'openapi.yaml');
const appPath = path.join(rootDir, 'server', 'App.js');

function printMountList(title, items) {
  if (!items.length) return;
  console.log(`[api-contract] ${title}`);
  items.forEach((item) => {
    const suffix = item.reason ? ` (${item.reason})` : '';
    console.log(`- ${item.method} ${item.runtimePath} -> ${item.contractPath}${suffix}`);
  });
}

const report = auditApiContract({
  openApiText: fs.readFileSync(openApiPath, 'utf8'),
  appSource: fs.readFileSync(appPath, 'utf8'),
});

console.log(`[api-contract] documented paths=${report.documentedPaths.length}`);
console.log(`[api-contract] express mounts=${report.mounts.length}`);
console.log(`[api-contract] documented mounts=${report.documented.length}`);
console.log(`[api-contract] explicit exemptions=${report.exempt.length}`);

if (process.argv.includes('--verbose')) {
  printMountList('explicitly exempt mounts', report.exempt);
}

if (report.shapeErrors.length) {
  console.error('[api-contract] shape errors');
  report.shapeErrors.forEach((error) => console.error(`- ${error}`));
}

if (report.duplicatePaths.length) {
  console.error('[api-contract] duplicate OpenAPI paths');
  report.duplicatePaths.forEach((item) => console.error(`- ${item.path} (${item.count})`));
}

if (report.missing.length) {
  printMountList('undocumented, non-exempt mounts', report.missing);
}

if (!report.ok) {
  process.exitCode = 1;
} else {
  console.log('[api-contract] ok');
}

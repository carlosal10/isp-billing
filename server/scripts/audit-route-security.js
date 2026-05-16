#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROUTE_MODULE_POLICIES,
  auditRouteSecurity,
} = require('../services/routeSecurityAuditService');

const rootDir = path.resolve(__dirname, '..', '..');

function readRoutePolicyFiles() {
  return Object.fromEntries(
    ROUTE_MODULE_POLICIES.map((policy) => {
      const absolutePath = path.join(rootDir, policy.file);
      return [policy.file, fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : ''];
    })
  );
}

function printMounts(title, mounts) {
  if (!mounts.length) return;
  console.log(`[route-security] ${title}`);
  mounts.forEach((mount) => {
    console.log(`- ${mount.key}`);
  });
}

const report = auditRouteSecurity({
  appSource: fs.readFileSync(path.join(rootDir, 'server', 'App.js'), 'utf8'),
  fileTextByPath: readRoutePolicyFiles(),
});

console.log(`[route-security] app mounts=${report.app.mounts.length}`);
console.log(`[route-security] classified mounts=${report.app.classified.length}`);
console.log(`[route-security] module policies checked=${report.modules.checked}`);

printMounts('unclassified mounts', report.app.unclassified);

if (report.app.guardMismatches.length) {
  console.error('[route-security] guard mismatches');
  report.app.guardMismatches.forEach((item) => {
    console.error(`- ${item.key} missing ${item.missingGuards.join(', ')}`);
  });
}

if (report.modules.missing.length) {
  console.error('[route-security] module policy failures');
  report.modules.missing.forEach((item) => {
    console.error(`- ${item.file}: ${item.reason}`);
    item.missingSnippets.forEach((snippet) => console.error(`  missing ${snippet}`));
  });
}

if (!report.ok) {
  process.exitCode = 1;
} else {
  console.log('[route-security] ok');
}

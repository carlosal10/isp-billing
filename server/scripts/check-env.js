#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const { getEnvReport } = require('../utils/env');

const report = getEnvReport(process.env);

console.log('[env] sanitized configuration');
Object.entries(report.sanitized).forEach(([key, value]) => {
  console.log(`- ${key}: ${value}`);
});

if (report.warnings.length) {
  console.log('[env] warnings');
  report.warnings.forEach((item) => console.log(`- ${item.key}: ${item.message}`));
}

if (report.errors.length) {
  console.error('[env] errors');
  report.errors.forEach((item) => console.error(`- ${item.key}: ${item.message}`));
  process.exitCode = 1;
} else {
  console.log('[env] ok');
}

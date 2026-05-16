#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const {
  buildPrivacyPolicyReport,
  formatPrivacyPolicyReport,
} = require('../services/privacyPolicyService');

const report = buildPrivacyPolicyReport(process.env);
const output = formatPrivacyPolicyReport(report);

if (report.ok) {
  console.log(output);
} else {
  console.error(output);
  process.exitCode = 1;
}

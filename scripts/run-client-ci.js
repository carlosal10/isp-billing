#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      CI: 'true',
    },
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(result.status || 1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['test', '--', '--watch=false']);
run('npm', ['run', 'build']);

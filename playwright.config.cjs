const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', timeout: 90000, workers: 1,
  use: { baseURL: 'http://localhost:5000', trace: 'retain-on-failure', screenshot: 'only-on-failure', browserName: 'chromium' },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node scripts/local-staging.js', url: 'http://localhost:5000/ready', timeout: 180000, reuseExistingServer: false },
});

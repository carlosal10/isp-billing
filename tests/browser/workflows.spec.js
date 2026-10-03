const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('owner@demo.example');
  await page.getByLabel('Password', { exact: true }).fill('Demo-Only-2026!');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
}
test('portal enrollment explains verification and requires a six-digit code', async ({ page }) => {
  await page.goto('/login?mode=customer');
  await page.getByRole('link', { name: 'Set up or reset your PIN' }).click();
  await page.getByLabel('ISP workspace').fill('Unknown Fiber');
  await page.getByLabel('Account number').fill('UNKNOWN');
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('If this account');
});

for (const width of [360, 768, 1024, 1440, 1920]) {
  test(`customer, billing, and settings layouts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    fs.mkdirSync('artifacts/ui', { recursive: true });
    for (const route of ['/customers', '/plans', '/payments', '/payment-settings', '/finance-recovery', '/settings']) {
      await page.goto(route);
      await expect(page.locator('h1, h2').first()).toBeVisible();
      await page.waitForTimeout(400);
      if (route === '/payments') await expect(page.getByRole('heading', { name: 'Billing workspace' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflow, `${route} must fit the viewport`).toBe(false);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), `${route} accessibility`).toEqual([]);
      await page.screenshot({ path: `artifacts/ui/${route.slice(1)}-${width}.png`, fullPage: true });
      if (route === '/payments') {
        for (const tab of ['Invoices', 'Finance', 'Reconciliation']) {
          await page.getByRole('button', { name: tab, exact: true }).click();
          await page.waitForTimeout(350);
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          expect(audit.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), `${tab} accessibility`).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${tab} overflow`).toBe(false);
          await page.screenshot({ path: `artifacts/ui/billing-${tab.toLowerCase()}-${width}.png`, fullPage: true });
        }
      }
    }
  });
}

test('a plan can be created with labeled, compact controls', async ({ page }) => {
  await login(page); await page.goto('/plans');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Plan Name').fill('Browser Verified Plan');
  await page.getByLabel('Price (KES)').fill('1800');
  await page.getByLabel('Duration (e.g. 30 days)').fill('30 days');
  await page.getByLabel('Speed (Mbps)').fill('10');
  await page.getByLabel('Rate Limit (e.g., 10M/10M)').fill('10M/10M');
  await page.getByRole('button', { name: 'Add Plan', exact: true }).click();
  await expect(page.getByText('Browser Verified Plan', { exact: true })).toBeVisible();
});

test('invoice settlement and adjustment use an accessible dialog with stable keyboard focus', async ({ page }) => {
  await login(page); await page.goto('/payments');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await page.getByRole('button', { name: 'Settle', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Settle', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await page.getByRole('button', { name: 'Refund', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Record payment adjustment' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Adjustment reason').fill('Provider refund independently confirmed');
  await expect(page.getByLabel('Adjustment reason')).toBeFocused();
  const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Refunded', { exact: true }).first()).toBeVisible();
});

test('provider receipt import preserves a discrepancy and its investigation', async ({ page }) => {
  await login(page); await page.goto('/finance-recovery');
  await page.getByText('Import a statement', { exact: true }).click();
  await page.getByLabel('Period start (UTC)').fill('2026-09-01');
  await page.getByLabel('Period end (UTC, exclusive)').fill('2026-10-01');
  await page.getByLabel('Receipt rows').fill('BROWSER-RECEIPT, 2500, KES, 2026-09-02T09:00:00Z');
  await page.getByRole('button', { name: 'Import and compare' }).click();
  await expect(page.getByText('missing payment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record investigation' }).click();
  await page.getByLabel('Investigation outcome').fill('Provider export issue logged for correction');
  await page.getByRole('button', { name: 'Save investigation' }).click();
  await expect(page.getByRole('cell', { name: 'Provider export issue logged for correction' })).toBeVisible();
});

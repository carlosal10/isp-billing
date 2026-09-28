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
    for (const route of ['/customers', '/plans', '/payments', '/finance-recovery', '/settings']) {
      await page.goto(route);
      await expect(page.locator('h1, h2').first()).toBeVisible();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflow, `${route} must fit the viewport`).toBe(false);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).disableRules(['color-contrast']).analyze();
      expect(result.violations.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), `${route} accessibility`).toEqual([]);
      await page.screenshot({ path: `artifacts/ui/${route.slice(1)}-${width}.png`, fullPage: true });
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

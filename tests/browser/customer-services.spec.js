const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
for (const width of [360, 1440]) test('customer onboarding and PPPoE use the same linked service at ' + width + 'px', async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const routerId = 'a'.repeat(24); let items = [], created, rotated, legacyWrites = 0, profileReads = 0;
  await page.route('**/api/mikrotik/servers', route => route.fulfill({ json: { servers: [{ id: routerId, name: 'Test router', host: '192.0.2.1', port: 8728 }] } }));
  await page.route('**/api/pppoe**', route => { if (route.request().method() !== 'GET') legacyWrites++; return route.fulfill({ status: 409, json: { error: 'Use linked services' } }); });
  await page.route('**/api/customers/profiles', route => { profileReads++; return route.fulfill({ json: { profiles: [] } }); });
  await page.route('**/api/network/assignments**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.endsWith('/discover/pppoe')) return route.fulfill({ json: { items: [{ username: 'existing-user', profile: 'basic', disabled: false }] } });
    if (req.method() === 'POST' && path.endsWith('/password')) rotated = req.postDataJSON();
    else if (req.method() === 'POST') {
      created = req.postDataJSON(); items = [{ ...created, password: undefined, _id: 'c'.repeat(24), accessType: 'pppoe', desiredState: 'suspended', manualState: 'present', billingState: 'blocked', status: 'provisioning', observedState: 'unknown' }];
    }
    if (req.method() === 'PATCH') { items[0].manualState = req.postDataJSON().desiredState; }
    await route.fulfill({ json: { ok: true, items, nextCursor: null } });
  });
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill('owner@demo.example');
  await page.getByLabel('Password', { exact: true }).fill('Demo-Only-2026!');
  await page.getByRole('button', { name: 'Login', exact: true }).click(); await expect(page).not.toHaveURL(/login/);
  await page.goto('/customers'); await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const name = 'Service Customer ' + width;
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('customer-' + width + '@example.test');
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('0700000000');
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill('Test street');
  const plans = page.getByRole('combobox', { name: 'Billing plan', exact: true });
  await expect(plans.locator('option')).not.toHaveCount(1);
  await plans.selectOption(await plans.locator('option').nth(1).getAttribute('value'));
  await expect(page.getByText('Select PPPoE Profile', { exact: true })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: 'artifacts/ui/customer-billing-' + width + '.png', fullPage: true });
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Customer saved' })).toBeVisible();
  const customerId = new URL(page.url()).searchParams.get('customerId'); expect(customerId).toMatch(/^[a-f0-9]{24}$/);
  expect(profileReads).toBe(0); expect(created).toBeUndefined();
  await page.getByRole('button', { name: 'Add subscriber', exact: true }).click();
  await page.getByRole('combobox', { name: 'Account setup', exact: true }).selectOption('link');
  await page.getByRole('combobox', { name: 'Existing PPPoE account', exact: true }).selectOption('existing-user');
  await expect(page.getByLabel(/^Subscriber password/)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'I confirm this router account belongs to the selected customer.' }).check();
  await page.getByRole('button', { name: 'Queue provisioning', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(created).toEqual({ customerId, routerId, username: 'existing-user' });
  await page.goto('/pppoe?customerId=' + customerId);
  await expect(page.getByRole('heading', { name: 'PPPoE services', exact: true })).toBeVisible();
  await expect(page.getByText('existing-user', { exact: true })).toBeVisible();
  await expect(page.getByText('Billing: Restricted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel(/^New subscriber password/).fill('New-Test-Password-2026!');
  await page.getByRole('button', { name: 'Queue password update', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); expect(rotated.password).toBe('New-Test-Password-2026!');
  expect(legacyWrites).toBe(0);
  await page.screenshot({ path: 'artifacts/ui/shared-pppoe-' + width + '.png', fullPage: true });
});

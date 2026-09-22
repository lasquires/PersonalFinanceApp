import { expect, test } from '@playwright/test';

async function openPreview(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open local preview' }).click();
  await expect(page.getByRole('heading', { name: 'Room for what matters.' })).toBeVisible();
  return errors;
}

test('desktop preview supports the core household workflow', async ({ page }) => {
  const errors = await openPreview(page);
  await expect(page.locator('.big-money')).toContainText('$575');

  await page.getByRole('button', { name: 'Transactions' }).first().click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Merchant').fill('Target');
  await page.getByLabel('Amount ($; negative for refund)').fill('42.75');
  await page.getByLabel('Category').selectOption('household');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /Target.*Household & Kids.*\$42\.75/ })).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).first().click();
  await expect(page.locator('.big-money')).toContainText('$532');

  await page.getByRole('button', { name: 'Plan' }).first().click();
  await page.getByRole('button', { name: 'Enter balance' }).first().click();
  await page.getByLabel('Amount ($)').fill('38200');
  await page.getByLabel('Note').fill('Confirmed opening balance');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('$38,200', { exact: true })).toBeVisible();
  await expect(page.getByText('~22 months')).toBeVisible();

  await page.getByRole('button', { name: 'Tasks' }).first().click();
  await page.getByRole('button', { name: 'Complete Enter tuition and funding dates' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Enter tuition and funding dates')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('keeps primary navigation and content usable without horizontal overflow', async ({ page }) => {
    const errors = await openPreview(page);
    const sizes = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Budget' }).click();
    await expect(page.getByRole('heading', { name: "This month's budget" })).toBeVisible();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Transactions' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
    const dialog = page.getByRole('dialog');
    const bounds = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: window.innerWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: /Luke.*Squires household/ }).click();
    await expect(page.getByRole('heading', { name: 'Household members' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite member' }).click();
    const inviteBounds = await page.getByRole('dialog').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: window.innerWidth };
    });
    expect(inviteBounds.left).toBeGreaterThanOrEqual(0);
    expect(inviteBounds.right).toBeLessThanOrEqual(inviteBounds.width);
    const settingsSizes = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(settingsSizes.width).toBeLessThanOrEqual(settingsSizes.viewport);
    expect(errors).toEqual([]);
  });
});

test('Household members settings expose admin invitation controls', async ({ page }) => {
  const errors = await openPreview(page);
  await page.getByRole('button', { name: /Luke.*Squires household/ }).click();
  await expect(page.getByRole('heading', { name: 'Household members' })).toBeVisible();
  await page.getByRole('button',{name:'Invite member'}).click();
  await page.getByLabel('Email').fill('guest@example.com');
  await expect(page.getByLabel('Access', { exact: true })).toHaveValue('viewer');
  await expect(page.getByRole('button',{name:'Send invitation'})).toBeEnabled();
  expect(errors).toEqual([]);
});

test('OAuth authorization page remains usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/authorize?authorization_id=test-request');
  await expect(page.getByRole('heading', { name:/Connect ChatGPT|Authorization unavailable/ })).toBeVisible();
  const sizes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
});

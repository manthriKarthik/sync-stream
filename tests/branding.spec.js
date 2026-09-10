const { test, expect } = require('@playwright/test');

test('approved Sonin branding loads on entry and survives the room workflow', async ({ page }, testInfo) => {
  await page.goto('/');
  const brand = page.getByRole('img', { name: 'Sonin', exact: true });
  await expect(brand).toBeVisible();
  await expect(brand.locator('img')).toHaveAttribute('src', '/sonin-unison-glass.svg');
  await expect(brand.locator('img')).toHaveJSProperty('naturalWidth', 2048);
  await expect(page.getByRole('heading', { name: 'Sonin', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(brand).toHaveCSS('font-family', 'Manrope, sans-serif');
  expect(await page.evaluate(() => document.fonts.check('550 28px Manrope'))).toBe(true);
  await expect(page.locator('.entry-submit')).toHaveCSS('background-color', 'rgb(37, 42, 51)');
  for (const selector of ['link[rel="icon"][type="image/svg+xml"]', 'link[rel="icon"][type="image/png"]', 'link[rel="apple-touch-icon"]']) {
    const asset = await page.locator(selector).getAttribute('href');
    const response = await page.request.get(asset);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sonin-entry.png'), fullPage: true, animations: 'disabled' });
  await page.getByLabel('Your name').fill('Brand check');
  await page.getByLabel('Room name').fill('Unison Room');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unison Room' })).toBeVisible();
  await expect(brand).toBeVisible();
  await expect(brand.locator('img')).toHaveJSProperty('naturalWidth', 2048);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sonin-room.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sonin home' })).toBeVisible();
});
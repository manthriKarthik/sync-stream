const { test, expect } = require('@playwright/test');
const artists = require('../client/src/artists.json');

test('all artist photos load, manual navigation pauses, and credits are available', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ed Sheeran', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause artist slideshow' }).click();
  for (const artist of artists) {
    await page.getByRole('button', { name: `Show ${artist.name}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible();
    await expect(page.locator('.artist-photo.is-active img')).toHaveJSProperty('complete', true);
    await expect(page.locator('.artist-photo.is-active img')).not.toHaveJSProperty('naturalWidth', 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.artist-stage').screenshot({ path: testInfo.outputPath(`${artist.id}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Show Anirudh Ravichander', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('anirudh.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Next artist' }).click();
  await expect(page.getByRole('heading', { name: 'Taylor Swift', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play artist slideshow' })).toBeVisible();
  await page.getByText('Photo credits', { exact: true }).click();
  await expect(page.locator('.artist-credits a').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('slideshow advances automatically, pauses, and respects reduced motion', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ed Sheeran', exact: true })).toBeVisible();
  await page.clock.fastForward(6600);
  await expect(page.getByRole('heading', { name: 'The Weeknd', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause artist slideshow' }).click();
  await page.clock.fastForward(14000);
  await expect(page.getByRole('heading', { name: 'The Weeknd', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Play artist slideshow' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next artist' }).click();
  await expect(page.getByRole('heading', { name: 'Michael Jackson', exact: true })).toBeVisible();
  await page.clock.fastForward(14000);
  await expect(page.getByRole('heading', { name: 'Michael Jackson', exact: true })).toBeVisible();
});
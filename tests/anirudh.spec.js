const { test, expect } = require('@playwright/test');

test('Anirudh uses separate supplied profile and background photos', async ({ page }, testInfo) => {
  await page.goto('/');
  const choice = page.getByRole('button', { name: 'Show Anirudh Ravichander', exact: true });
  await choice.click();
  const profile = choice.locator('img');
  const background = page.locator('.artist-photo.is-active img');
  await expect(profile).toHaveAttribute('src', '/artists/ani2.webp');
  await expect(background).toHaveAttribute('src', '/artists/BackAni.jpg');
  for (const image of [profile, background]) {
    await expect(image).toHaveJSProperty('complete', true);
    await expect(image).not.toHaveJSProperty('naturalWidth', 0);
  }
  await page.screenshot({ path: testInfo.outputPath('anirudh-custom.png'), fullPage: true, animations: 'disabled' });
});
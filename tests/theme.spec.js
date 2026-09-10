const { test, expect } = require('@playwright/test');

test('pearl theme animates mode changes without moving fields or losing input', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.entranceAnimations = [];
    document.addEventListener('animationstart', event => window.entranceAnimations.push(event.animationName));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause artist slideshow' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause artist slideshow' }).click();
  expect(await page.evaluate(() => window.entranceAnimations)).toContain('spotlight-arrive');
  await expect(page.locator('.entry-header')).toHaveCSS('position', 'sticky');
  await page.getByLabel('Your name').fill('Sam');
  const tabs = page.getByRole('group', { name: 'Room action' });
  const before = await tabs.boundingBox();
  await expect(tabs).toHaveCSS('background-color', 'rgb(223, 229, 237)');
  await page.getByRole('button', { name: 'Join a room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Sam');
  await expect.poll(() => tabs.evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return Math.abs(new DOMMatrix(style.transform).m41 - parseFloat(style.width));
  })).toBeLessThan(1);
  const after = await tabs.boundingBox();
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
  await page.getByLabel('Your name').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Room code', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('Sam');
  await page.getByLabel('Room name').fill('Pearl Sessions');
  await expect.poll(() => tabs.evaluate(element => new DOMMatrix(getComputedStyle(element, '::before').transform).m41)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('pearl-entry.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pearl Sessions' })).toBeVisible();
  const modes = page.locator('.mode-toggle');
  await modes.getByRole('button', { name: 'Everyone', exact: true }).click();
  await expect.poll(() => modes.evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return Math.abs(new DOMMatrix(style.transform).m41 - parseFloat(style.width));
  })).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('glass-room.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
});

test('reduced motion removes entrance and tab animations but keeps navigation usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play artist slideshow' })).toBeDisabled();
  await expect(page.locator('.entry-title h1')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Join a room', exact: true }).click();
  const motion = await page.locator('.entry-tabs').evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return { duration: style.transitionDuration, distance: new DOMMatrix(style.transform).m41, width: parseFloat(style.width) };
  });
  expect(motion.duration).toBe('0s');
  expect(motion.distance).toBeCloseTo(motion.width, 0);
  await page.getByRole('button', { name: 'Next artist' }).click();
  await expect(page.getByRole('heading', { name: 'The Weeknd', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await page.getByLabel('Your name').fill('Motion check');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.room-toolbar')).toBeVisible();
  await expect(page.locator('.room-toolbar')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.player-bar')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
});
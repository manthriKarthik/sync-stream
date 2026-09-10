const { test, expect } = require('@playwright/test');

test('music sources exclude Spotify and never load its SDK', async ({ page, request }) => {
  const spotifyRequests = [];
  const errors = [];
  page.on('request', request => {
    if (/spotify|scdn\.co/i.test(request.url())) spotifyRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Your name').fill('Source Tester');
  await page.getByLabel('Room name').fill('Source Check');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source Check' })).toBeVisible();
  await expect(page.locator('.platform-tab')).toHaveText(['Audius', 'Saavn', 'SoundCloud', 'YouTube', 'Upload']);
  await expect(page.getByText(/spotify/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  await expect(page.getByPlaceholder('Paste YouTube URL...')).toBeVisible();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByLabel('Audio file')).toBeAttached();
  expect(spotifyRequests).toEqual([]);
  expect(errors).toEqual([]);
  const config = await request.get('/api/platforms/config');
  expect(await config.json()).not.toHaveProperty('spotify');
  const token = await request.post('/api/platforms/spotify/token', { data: {} });
  expect(token.status()).toBe(404);
});
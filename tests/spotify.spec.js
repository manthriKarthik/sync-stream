const { test, expect } = require('@playwright/test');

async function setupSpotify(page, context) {
  await context.route('**/api/platforms/config', route => route.fulfill({ json: { spotify: { clientId: 'test-client', available: true } } }));
  await context.route('https://sdk.scdn.co/spotify-player.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.__loadSpotify = () => {
      window.Spotify = { Player: class {
        constructor() { this.listeners = {}; }
        addListener(name, handler) { this.listeners[name] = handler; }
        connect() {
          window.__spotifyConnects = (window.__spotifyConnects || 0) + 1;
          if (window.__spotifyRefuse) return Promise.resolve(false);
          setTimeout(() => this.listeners.ready({ device_id: 'test-device' }), 0);
          return Promise.resolve(true);
        }
        disconnect() {}
      } };
      window.onSpotifyWebPlaybackSDKReady();
    };`
  }));
  await page.goto('/');
  await page.getByLabel('Your name').fill('Spotify Tester');
  await page.getByLabel('Room name').fill('Spotify Check');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spotify Check' })).toBeVisible();
  await page.getByRole('button', { name: 'Spotify', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__loadSpotify)).toBe('function');
}

async function authorize(page, context, baseURL, { wrongState = false } = {}) {
  await context.route('https://accounts.spotify.com/authorize?**', route => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('state')).toBeTruthy();
    expect(query.get('redirect_uri')).toBe(`${baseURL}/callback/spotify`);
    return route.fulfill({ status: 302, headers: { location: `${baseURL}/callback/spotify?code=test-code&state=${wrongState ? 'wrong' : query.get('state')}` } });
  });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Connect Spotify (Premium required)', exact: true }).click();
  return popupPromise;
}

test('Spotify preserves login until SDK is ready and allows disconnect/reconnect', async ({ page, context, baseURL }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupSpotify(page, context);
  await context.route('**/api/platforms/spotify/token', async route => {
    expect(route.request().postDataJSON().codeVerifier).toHaveLength(64);
    await route.fulfill({ json: { accessToken: 'mock-token' } });
  });
  await authorize(page, context, baseURL);
  await expect(page.getByRole('button', { name: 'Connecting Spotify player...' })).toBeVisible();
  expect(await page.evaluate(() => window.__spotifyConnects || 0)).toBe(0);
  await page.evaluate(() => window.__loadSpotify());
  await expect(page.getByText('Connected to Spotify', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await authorize(page, context, baseURL);
  await expect(page.getByText('Connected to Spotify', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__spotifyConnects)).toBe(2);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('spotify_auth_')))).toEqual([]);
  expect(errors).toEqual([]);
});

test('Spotify displays account denial in the room and permits retry', async ({ page, context, baseURL }) => {
  await setupSpotify(page, context);
  await context.route('**/api/platforms/spotify/token', route => route.fulfill({ status: 403, json: { error: 'Spotify denied access. Ask the app owner to add your email in Users Management.' } }));
  await authorize(page, context, baseURL);
  await expect(page.getByRole('alert')).toContainText('Users Management');
  await expect(page.getByRole('button', { name: 'Connect Spotify (Premium required)', exact: true })).toBeEnabled();
});

test('Spotify callback stops a stalled token exchange', async ({ page, context, baseURL }) => {
  await context.addInitScript(() => {
    const original = window.setTimeout;
    window.setTimeout = (handler, delay, ...args) => original(handler, delay === 25000 ? 100 : delay, ...args);
  });
  await setupSpotify(page, context);
  await context.route('**/api/platforms/spotify/token', () => {});
  await authorize(page, context, baseURL);
  await expect(page.getByRole('alert')).toContainText('timed out');
  await expect(page.getByRole('button', { name: 'Connect Spotify (Premium required)', exact: true })).toBeEnabled();
});

test('Spotify rejects mismatched OAuth state before token exchange', async ({ page, context, baseURL }) => {
  await setupSpotify(page, context);
  let exchanges = 0;
  await context.route('**/api/platforms/spotify/token', route => { exchanges++; return route.fulfill({ json: {} }); });
  const popup = await authorize(page, context, baseURL, { wrongState: true });
  await expect(popup.getByRole('alert')).toContainText('does not match');
  expect(exchanges).toBe(0);
  await popup.close();
  await expect(page.getByRole('alert')).toContainText('closed or expired');
});

test('Spotify reports a refused SDK connection instead of silently doing nothing', async ({ page, context, baseURL }) => {
  await setupSpotify(page, context);
  await page.evaluate(() => { window.__spotifyRefuse = true; window.__loadSpotify(); });
  await context.route('**/api/platforms/spotify/token', route => route.fulfill({ json: { accessToken: 'mock-token' } }));
  await authorize(page, context, baseURL);
  await expect(page.getByRole('alert')).toContainText('refused the player connection');
  await expect(page.getByRole('button', { name: 'Connect Spotify (Premium required)', exact: true })).toBeEnabled();
});

test('Spotify reports blocked popups', async ({ page, context }) => {
  await setupSpotify(page, context);
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Connect Spotify (Premium required)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Allow popups');
});
const { test, expect } = require('@playwright/test');

async function mockYouTube(page, { deferReady = false, blocked = false, buffering = false } = {}) {
  await page.addInitScript(({ deferReady, blocked, buffering }) => {
    const mock = window.__youtubeMock = { players: [], blocked, buffering };
    window.YT = {
      Player: function (targetOrId, options) {
        const target = typeof targetOrId === 'string' ? document.getElementById(targetOrId) : targetOrId;
        if (!target) throw new Error('YouTube player mount is missing');
        const iframe = document.createElement('iframe');
        iframe.title = 'YouTube video player';
        target.replaceWith(iframe);
        const player = {
          loads: [],
          seeks: [],
          hiddenStarts: [],
          state: -1,
          position: 0,
          muted: false,
          destroyed: false,
          ready: () => options.events.onReady({ target: player }),
          getIframe: () => iframe,
          getCurrentTime: () => player.position,
          getDuration: () => 240,
          getPlayerState: () => player.state,
          setVolume() {},
          mute() { player.muted = true; },
          unMute() { player.muted = false; },
          loadVideoById(track) {
            player.loads.push(track);
            player.position = track.startSeconds;
          },
          playVideo() {
            player.hiddenStarts.push(!!iframe.closest('[hidden]'));
            player.state = mock.buffering ? 3 : mock.blocked ? 5 : 1;
            options.events.onStateChange({ data: player.state, target: player });
            if (mock.blocked) options.events.onAutoplayBlocked?.({ target: player });
          },
          pauseVideo() {
            player.state = 2;
            options.events.onStateChange({ data: 2, target: player });
          },
          stopVideo() { player.state = -1; },
          seekTo(position) {
            player.seeks.push(position);
            player.position = position;
          },
          fail(code) {
            player.state = -1;
            options.events.onError({ data: code, target: player });
          },
          destroy() {
            player.destroyed = true;
            iframe.remove();
          }
        };
        mock.players.push(player);
        if (!deferReady) setTimeout(player.ready, 0);
        return player;
      }
    };
  }, { deferReady, blocked, buffering });
}

async function createYouTubeRoom(page) {
  await page.getByLabel('Your name').fill('YouTube Tester');
  await page.getByLabel('Room name').fill('YouTube Readiness');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'YouTube Readiness' })).toBeVisible();
}

async function addYouTubeTrack(page) {
  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  await page.getByPlaceholder('Paste YouTube URL...').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.locator('.queue-item')).toHaveCount(1);
}

test('YouTube initializes when its API is already loaded and cleans up on re-entry', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockYouTube(page);
  await page.goto('/');
  await createYouTubeRoom(page);
  await expect(page.locator('#yt-player-container iframe')).toHaveCount(1);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].destroyed)).toBe(true);
  await expect(page.locator('#yt-player-container')).toHaveCount(0);
  await createYouTubeRoom(page);
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players.length)).toBe(2);
  expect(errors).toEqual([]);
  await expect(page.locator('#yt-player-container iframe')).toHaveCount(1);
});

test('YouTube offers a visible gesture fallback and reloads failed videos on retry', async ({ page }, testInfo) => {
  await mockYouTube(page, { blocked: true });
  await page.goto('/');
  await createYouTubeRoom(page);
  await addYouTubeTrack(page);
  const fallback = page.getByRole('button', { name: 'Play YouTube audio', exact: true });
  await expect(fallback).toBeVisible();
  const iframe = page.locator('#yt-player-container iframe');
  await expect(iframe).toBeAttached();
  await expect(iframe).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('youtube-recovery.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { window.__youtubeMock.blocked = false; });
  await fallback.click();
  await expect(fallback).toHaveCount(0);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(1);
  await page.evaluate(() => window.__youtubeMock.players[0].fail(150));
  await expect(page.getByRole('alert')).toContainText('does not allow playback outside YouTube');
  await page.getByRole('button', { name: 'Retry YouTube', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.__youtubeMock.players[0].fail(153));
  await expect(page.getByRole('alert')).toContainText('referrer/privacy settings');
});

test('YouTube cancels queued playback when paused before the player is ready', async ({ page }) => {
  await mockYouTube(page, { deferReady: true });
  await page.goto('/');
  await createYouTubeRoom(page);
  await addYouTubeTrack(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    window.__youtubeMock.players[0].ready();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => window.__youtubeMock.players[0].loads)).toEqual([]);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].state)).toBe(1);
});

test('YouTube delayed readiness starts at the current room position', async ({ page }) => {
  await mockYouTube(page, { deferReady: true });
  await page.goto('/');
  await createYouTubeRoom(page);
  await page.clock.install();
  await addYouTubeTrack(page);
  await page.clock.runFor(5000);
  await page.evaluate(() => window.__youtubeMock.players[0].ready());
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(1);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].loads[0].startSeconds)).toBeGreaterThanOrEqual(4.5);
});

test('YouTube buffering is not interrupted by automatic retries', async ({ page }) => {
  await mockYouTube(page, { buffering: true });
  await page.goto('/');
  await createYouTubeRoom(page);
  await page.clock.install();
  await addYouTubeTrack(page);
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].state)).toBe(3);
  await page.clock.runFor(7000);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(1);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].seeks)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Play YouTube audio', exact: true })).toHaveCount(0);
});

test('YouTube starts visibly on add and a late listener can recover blocked audio without host toggles', async ({ page, browser }, testInfo) => {
  await mockYouTube(page);
  await page.goto('/');
  await createYouTubeRoom(page);
  await addYouTubeTrack(page);
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].state)).toBe(1);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].hiddenStarts)).not.toContain(true);

  const code = (await page.getByRole('button', { name: 'Copy room code' }).textContent()).trim();
  const guestContext = await browser.newContext(testInfo.project.use);
  try {
    const guest = await guestContext.newPage();
    await mockYouTube(guest, { deferReady: true, blocked: true });
    await guest.goto(testInfo.project.use.baseURL);
    await guest.getByRole('button', { name: 'Join a room', exact: true }).click();
    await guest.getByLabel('Your name').fill('YouTube Listener');
    await guest.getByLabel('Room code', { exact: true }).fill(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.locator('.queue-item')).toHaveCount(1);
    await guest.evaluate(() => window.__youtubeMock.players[0].ready());
    await expect.poll(() => guest.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(1);
    const startsBeforeEnable = await guest.evaluate(() => {
      window.__youtubeMock.blocked = false;
      return window.__youtubeMock.players[0].hiddenStarts.length;
    });
    await guest.getByRole('button', { name: 'Play YouTube audio', exact: true }).click();
    await expect.poll(() => guest.evaluate(() => window.__youtubeMock.players[0].state)).toBe(1);
    expect(await guest.evaluate(() => window.__youtubeMock.players[0].hiddenStarts.length)).toBe(startsBeforeEnable + 1);
    await expect(guest.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    expect(await guest.evaluate(() => window.__youtubeMock.players[0].hiddenStarts)).not.toContain(true);
    expect(await page.evaluate(() => window.__youtubeMock.players[0].loads.length)).toBe(1);
    await page.getByPlaceholder('Paste YouTube URL...').fill('https://www.youtube.com/watch?v=jfKfPfyJRdk');
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await expect(guest.locator('.queue-item')).toHaveCount(2);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    for (const listener of [page, guest]) {
      await expect.poll(() => listener.evaluate(() => window.__youtubeMock.players[0].loads.at(-1).videoId)).toBe('jfKfPfyJRdk');
      await expect.poll(() => listener.evaluate(() => window.__youtubeMock.players[0].state)).toBe(1);
      expect(await listener.evaluate(() => window.__youtubeMock.players[0].muted)).toBe(false);
    }
  } finally {
    await guestContext.close();
  }
});

test('YouTube lock-screen controls use the live player position while hidden', async ({ page }) => {
  await mockYouTube(page);
  await page.addInitScript(() => {
    window.__mediaActions = {};
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler(action, handler) { window.__mediaActions[action] = handler; },
        setPositionState() {}
      }
    });
  });
  await page.goto('/');
  await createYouTubeRoom(page);
  await addYouTubeTrack(page);
  await expect.poll(() => page.evaluate(() => typeof window.__mediaActions.pause)).toBe('function');
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toContain('dQw4w9WgXcQ');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__youtubeMock.players[0].position = 42;
    window.__mediaActions.seekbackward({ seekOffset: 10 });
  });
  expect(await page.evaluate(() => window.__youtubeMock.players[0].seeks.at(-1))).toBe(32);
  await page.evaluate(() => window.__mediaActions.pause());
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].state)).toBe(2);
  await page.evaluate(() => {
    window.__youtubeMock.players[0].position = 32;
    window.__mediaActions.play();
  });
  await expect.poll(() => page.evaluate(() => window.__youtubeMock.players[0].state)).toBe(1);
  expect(await page.evaluate(() => window.__youtubeMock.players[0].position)).toBeCloseTo(32, 0);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
});

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
  for (const source of ['Audius', 'Saavn', 'SoundCloud', 'YouTube', 'Upload']) {
    await page.getByRole('button', { name: source, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
    await expect(page.getByText('Audio on this device is off', { exact: true })).toHaveCount(0);
  }
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
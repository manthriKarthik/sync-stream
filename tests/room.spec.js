const { test, expect } = require('@playwright/test');

function audioFixture() {
  const sampleRate = 8000;
  const samples = sampleRate * 30;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function createRoom(page) {
  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Room name').fill('After Hours');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'After Hours' })).toBeVisible();
  return (await page.getByRole('button', { name: 'Copy room code' }).textContent()).trim();
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('entry form handles invalid codes, keyboard submit, and responsive layout', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create room', exact: true })).toBeDisabled();
  await expect(page.locator('.artist-photo.is-active img')).toHaveJSProperty('complete', true);
  await expect(page.locator('.artist-photo.is-active img')).not.toHaveJSProperty('naturalWidth', 0);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('entry.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Join a room', exact: true }).click();
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByLabel('Room code', { exact: true }).fill('bad-code');
  await page.getByLabel('Room code', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('Room not found');
  await expect(page.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('upload, play, seek, pause, remove and leave work without leaking audio', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
  await expect(page.getByRole('alert')).toContainText('Choose an MP3');
  await page.getByLabel('Audio file').setInputFiles({ name: 'Listening test.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  await page.getByRole('slider', { name: 'Playback position' }).fill('10');
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(9);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(true);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('room.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Remove Listening test.wav' }).click();
  await expect(page.locator('.queue-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('returning to Chrome does not hard-seek a playing song with small drift', async ({ page }) => {
  await createRoom(page);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Foreground test.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime), { timeout: 10000 }).toBeGreaterThan(4);
  const before = await page.locator('audio').evaluate(audio => {
    audio.currentTime -= 1.2;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.__foregroundSeeks = [];
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { window.__foregroundSeeks.push(value); descriptor.set.call(this, value); }
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    return audio.currentTime;
  });
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime), { timeout: 8000 }).toBeGreaterThan(before + 3);
  expect(await page.evaluate(() => window.__foregroundSeeks)).toEqual([]);
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(false);
  await page.getByRole('slider', { name: 'Playback position' }).fill('20');
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(19);
});

test('two listeners exchange chat, receive control, and transfer host on leave', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Shared listen.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  const guestContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const guest = await guestContext.newPage();
  await guest.goto(testInfo.project.use.baseURL);
  await guest.getByRole('button', { name: 'Join a room', exact: true }).click();
  await guest.getByLabel('Your name').fill('Jamie');
  await guest.getByLabel('Room code', { exact: true }).fill(code.toUpperCase());
  await guest.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(guest.getByRole('heading', { name: 'After Hours' })).toBeVisible();
  await guest.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await expect.poll(() => guest.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  const hostPosition = await page.locator('audio').evaluate(audio => audio.currentTime);
  const guestPosition = await guest.locator('audio').evaluate(audio => audio.currentTime);
  expect(Math.abs(hostPosition - guestPosition)).toBeLessThan(1.5);
  await expect(guest.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open listeners and chat' }).click();
  await guest.getByRole('button', { name: 'Open listeners and chat' }).click();
  await page.getByPlaceholder('Type a message...').fill('This is our song.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(guest.locator('.chat-msg')).toContainText('This is our song.');
  await page.getByRole('button', { name: 'Give control', exact: true }).click();
  await expect(guest.getByText('DJ', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Close listeners and chat' }).click();
  await guest.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(true);
  await guest.getByRole('button', { name: 'Open listeners and chat' }).click();
  await noOverflow(guest);
  await guest.screenshot({ path: testInfo.outputPath('chat.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Close listeners and chat' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await guest.getByRole('button', { name: 'Close listeners and chat' }).click();
  await expect(guest.getByRole('button', { name: 'Host controls', exact: true })).toBeVisible();
  await guestContext.close();
});

test('switching providers discards an in-flight search', async ({ page }) => {
  let releaseSearch;
  const blocked = new Promise(resolve => { releaseSearch = resolve; });
  await page.route('**/api/audius/search?*', async route => {
    await blocked;
    await route.fulfill({ json: { results: [{ id: 'old', name: 'Stale Audius track', platform: 'audius' }] } });
  });
  await createRoom(page);
  await page.getByPlaceholder('Search Audius for music...').fill('Night');
  const request = page.waitForRequest('**/api/audius/search?*');
  await page.getByPlaceholder('Search Audius for music...').press('Enter');
  await request;
  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  const response = page.waitForResponse('**/api/audius/search?*');
  releaseSearch();
  await response;
  await expect(page.getByText('Stale Audius track')).toHaveCount(0);
});

test('small phones and reduced motion retain usable controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await noOverflow(page);
  expect(await page.locator('.artist-photo.is-active img').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await createRoom(page);
  await page.getByRole('button', { name: 'Open listeners and chat' }).click();
  await expect(page.getByRole('button', { name: 'Close listeners and chat' })).toBeInViewport();
  await noOverflow(page);
});

test('public provider failures show errors rather than empty results', async ({ page }) => {
  await page.route('**/api/*/search?*', route => route.fulfill({ status: 502, json: { error: 'Provider unavailable' } }));
  await createRoom(page);
  for (const provider of ['Audius', 'Saavn', 'SoundCloud', 'YouTube']) {
    await page.getByRole('button', { name: provider, exact: true }).click();
    const search = page.locator('.music-browser input[placeholder^="Search"]');
    await search.fill('night');
    await search.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Search unavailable');
    await expect(page.locator('.search-empty')).toHaveCount(0);
  }
});
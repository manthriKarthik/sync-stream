const { test, expect } = require('@playwright/test');

function audioFixture(durationSeconds = 30) {
  const sampleRate = 8000;
  const samples = sampleRate * durationSeconds;
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

async function captureMediaSession(page) {
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
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
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

test('returning from an app interruption resumes small drift without skipping audio', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Interrupted playback.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime), { timeout: 10000 }).toBeGreaterThan(4);
  const position = await page.locator('audio').evaluate(audio => {
    audio.pause();
    audio.currentTime -= 1;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.interruptionSeeks = [];
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { window.interruptionSeeks.push(value); descriptor.set.call(this, value); }
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    return audio.currentTime;
  });
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(position + 2);
  expect(await page.evaluate(() => window.interruptionSeeks)).toEqual([]);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
});

test('shared audio survives a hidden page and lock-screen controls act immediately', async ({ page }) => {
  await captureMediaSession(page);
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Lock screen.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  const before = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return document.querySelector('audio').currentTime;
  });
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(before + 1);
  await page.evaluate(() => window.__mediaActions.pause());
  await expect(page.locator('audio')).toHaveJSProperty('paused', true);
  const pausedAfterPlay = await page.evaluate(() => {
    window.__mediaActions.play();
    return document.querySelector('audio').paused;
  });
  expect(pausedAfterPlay).toBe(false);
  const skippedPosition = await page.evaluate(() => {
    document.querySelector('audio').currentTime = 14;
    window.__mediaActions.seekbackward({ seekOffset: 10 });
    return document.querySelector('audio').currentTime;
  });
  expect(skippedPosition).toBeCloseTo(4, 0);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
});

test('queued audio starts after the current song ends while hidden', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  for (const name of ['First background song.wav', 'Next background song.wav']) {
    await page.getByLabel('Audio file').setInputFiles({ name, mimeType: 'audio/wav', buffer: audioFixture() });
    await expect(page.locator('.queue-item').filter({ hasText: name })).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  await page.getByRole('slider', { name: 'Playback position' }).fill('28');
  const firstSource = await page.locator('audio').evaluate(audio => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return audio.src;
  });
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.src)).not.toBe(firstSource);
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0.5)).toBe(true);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
});

test('Saavn does not loop an early-ended stream and advances without host activity', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const tracks = [
    { id: 'short-saavn', name: 'Short Saavn response', platform: 'saavn', url: '/api/saavn/stream?fixture=short', duration: 20000 },
    { id: 'next-saavn', name: 'Next Saavn song', platform: 'saavn', url: '/api/saavn/stream?fixture=next', duration: 30000 }
  ];
  await page.route('**/api/saavn/search?*', route => route.fulfill({ json: { results: tracks } }));
  await page.route('**/api/saavn/stream?*', route => route.fulfill({
    contentType: 'audio/wav', body: audioFixture(route.request().url().includes('short') ? 3 : 30)
  }));
  await createRoom(page);
  await page.locator('audio').evaluate(audio => {
    window.__audioStarts = 0;
    window.__audioEvents = [];
    for (const event of ['loadstart', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'error']) {
      audio.addEventListener(event, () => window.__audioEvents.push({
        event, time: audio.currentTime, paused: audio.paused, ended: audio.ended, at: Date.now()
      }));
    }
    audio.addEventListener('play', () => { window.__audioStarts += 1; });
    audio.addEventListener('ended', () => { window.__endedAt = Date.now(); });
  });
  await page.getByRole('button', { name: 'Saavn', exact: true }).click();
  await page.getByPlaceholder('Search songs (Hindi, English, Telugu, Tamil...)').fill('fixture');
  await page.getByPlaceholder('Search songs (Hindi, English, Telugu, Tamil...)').press('Enter');
  await page.locator('.search-result-row').filter({ hasText: tracks[0].name }).click();
  await page.locator('.search-result-row').filter({ hasText: tracks[1].name }).click();
  await expect(page.locator('.queue-item')).toHaveCount(2);
  try {
    await expect.poll(() => page.evaluate(() => Number.isFinite(window.__endedAt)), { timeout: 12000 }).toBe(true);
  } finally {
    await testInfo.attach('media-events', {
      body: JSON.stringify(await page.locator('audio').evaluate(audio => ({
        events: window.__audioEvents, time: audio.currentTime, duration: audio.duration,
        paused: audio.paused, ended: audio.ended, seeking: audio.seeking, readyState: audio.readyState
      }))), contentType: 'application/json'
    });
  }
  await expect.poll(() => page.evaluate(() => Date.now() - window.__endedAt)).toBeGreaterThan(3500);
  expect(await page.evaluate(() => window.__audioStarts)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.src), { timeout: 20000 }).toContain('fixture=next');
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
});

test('shared audio exposes a gesture fallback after an interrupted background session', async ({ page }) => {
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Resume audio.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  await page.locator('audio').evaluate(audio => {
    const originalPlay = audio.play.bind(audio);
    window.__blockAudioPlayback = true;
    audio.play = () => window.__blockAudioPlayback
      ? Promise.reject(new DOMException('User gesture required', 'NotAllowedError'))
      : originalPlay();
    audio.pause();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const resume = page.getByRole('button', { name: 'Resume audio', exact: true });
  await expect(resume).toBeVisible();
  await page.evaluate(() => { window.__blockAudioPlayback = false; });
  await resume.click();
  await expect(page.locator('audio')).toHaveJSProperty('paused', false);
  await expect(resume).toHaveCount(0);
});

test('two listeners exchange chat, receive control, and transfer host on leave', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Shared listen.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  const guestContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const guest = await guestContext.newPage();
  await captureMediaSession(guest);
  await guest.goto(testInfo.project.use.baseURL);
  await guest.getByRole('button', { name: 'Join a room', exact: true }).click();
  await guest.getByLabel('Your name').fill('Jamie');
  await guest.getByLabel('Room code', { exact: true }).fill(code.toUpperCase());
  await guest.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(guest.getByRole('heading', { name: 'After Hours' })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await expect.poll(() => guest.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
  const hostSample = await page.locator('audio').evaluate(audio => ({ position: audio.currentTime, at: Date.now() }));
  const guestSample = await guest.locator('audio').evaluate(audio => ({ position: audio.currentTime, at: Date.now() }));
  const hostPosition = hostSample.position + (guestSample.at - hostSample.at) / 1000;
  expect(Math.abs(hostPosition - guestSample.position)).toBeLessThan(1.5);
  await expect(guest.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  await guest.evaluate(() => window.__mediaActions.pause());
  await expect(guest.locator('audio')).toHaveJSProperty('paused', true);
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(hostPosition + 2);
  await expect(guest.locator('audio')).toHaveJSProperty('paused', true);
  const guestPausedAfterPlay = await guest.evaluate(() => {
    window.__mediaActions.play();
    return document.querySelector('audio').paused;
  });
  expect(guestPausedAfterPlay).toBe(false);
  await expect(guest.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open listeners and chat' }).click();
  await guest.getByRole('button', { name: 'Open listeners and chat' }).click();
  await page.getByPlaceholder('Type a message...').fill('This is our song.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(guest.locator('.chat-msg')).toContainText('This is our song.');
  // Let everyone control playback so the guest can pause below.
  await page.getByRole('button', { name: 'Close listeners and chat' }).click();
  await page.getByRole('button', { name: 'Everyone', exact: true }).click();
  await page.getByRole('button', { name: 'Open listeners and chat' }).click();
  await guest.getByRole('button', { name: 'Close listeners and chat' }).click();
  // Mute status is shared: when the guest mutes, the host sees it in the panel.
  await expect(page.locator('.member-row', { hasText: 'Jamie' }).getByText('Listening', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Listening', exact: true }).click();
  await expect(page.locator('.member-row', { hasText: 'Jamie' }).getByText('Muted', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Muted', exact: true }).click();
  await expect(page.locator('.member-row', { hasText: 'Jamie' }).getByText('Listening', { exact: true })).toBeVisible();
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

test('network loss preserves buffered audio, disables room commands, and allows offline leave', async ({ page, context }) => {
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Offline playback.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(1);
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.buffered.length && audio.buffered.end(0))).toBeGreaterThan(25);
  await context.setOffline(true);
  try {
    await expect(page.getByText('Reconnecting to your room...', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    await expect(page.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Everyone', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Choose audio file', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'YouTube', exact: true }).click();
    await page.getByPlaceholder('Paste YouTube URL...').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByRole('button', { name: 'Open listeners and chat' }).click();
    await page.getByRole('textbox', { name: 'Chat message' }).fill('Draft while offline');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close listeners and chat' }).click();
    const before = await page.locator('audio').evaluate(audio => audio.currentTime);
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(before + 1);
    const volume = page.getByRole('slider', { name: 'Volume', exact: true });
    if (await volume.isVisible()) {
      await volume.fill('0.5');
      await expect(page.locator('audio')).toHaveJSProperty('volume', 0.5);
    } else {
      await page.getByRole('button', { name: 'Listening', exact: true }).click();
      await expect(page.locator('audio')).toHaveJSProperty('muted', true);
      await page.getByRole('button', { name: 'Muted', exact: true }).click();
      await expect(page.locator('audio')).toHaveJSProperty('muted', false);
    }
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByText('Reconnecting to your room...', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open listeners and chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('Draft while offline');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-msg')).toContainText('Draft while offline');
  await page.getByRole('button', { name: 'Close listeners and chat' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('audio')).toHaveJSProperty('paused', true);
  await context.setOffline(true);
  try {
    await expect(page.getByText('Reconnecting to your room...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByText('Ready to connect', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a reconnecting guest applies missed pause and track changes without duplicate members', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  for (const name of ['First track.wav', 'Second track.wav']) {
    await page.getByLabel('Audio file').setInputFiles({ name, mimeType: 'audio/wav', buffer: audioFixture() });
  }
  await expect(page.locator('.queue-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const guestContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(testInfo.project.use.baseURL);
    await guest.getByRole('button', { name: 'Join a room', exact: true }).click();
    await guest.getByLabel('Your name').fill('Returning listener');
    await guest.getByLabel('Room code', { exact: true }).fill(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
    await expect.poll(() => guest.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
    await guestContext.setOffline(true);
    await expect(guest.getByText('Reconnecting to your room...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    await guestContext.setOffline(false);
    await expect(guest.getByText('Reconnecting to your room...', { exact: true })).toHaveCount(0);
    await expect(guest.locator('audio')).toHaveJSProperty('paused', true);
    const pausedAt = await page.locator('audio').evaluate(audio => audio.currentTime);
    expect(await guest.locator('audio').evaluate(audio => audio.currentTime)).toBeCloseTo(pausedAt, 0);
    await guestContext.setOffline(true);
    await expect(guest.getByText('Reconnecting to your room...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.player-track-info')).toContainText('Second track.wav');
    await guestContext.setOffline(false);
    await expect(guest.getByText('Reconnecting to your room...', { exact: true })).toHaveCount(0);
    await expect(guest.locator('.player-track-info')).toContainText('Second track.wav');
    await expect.poll(() => guest.locator('audio').evaluate(audio => !audio.paused && audio.currentTime > 0)).toBe(true);
    await guest.getByRole('button', { name: 'Open listeners and chat' }).click();
    await expect(guest.locator('.member-row')).toHaveCount(2);
  } finally {
    await guestContext.close();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
  }
});

test('failed audio requests recover after the connection returns', async ({ page, context }) => {
  let failAudio = true;
  await page.route('**/uploads/**', route => failAudio ? route.abort('internetdisconnected') : route.continue());
  await createRoom(page);
  await expect(page.getByRole('button', { name: 'Enable audio', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Audio file').setInputFiles({ name: 'Recoverable stream.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.queue-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => !!audio.error)).toBe(true);
  await context.setOffline(true);
  try {
    await expect(page.getByText('Reconnecting to your room...', { exact: true })).toBeVisible();
    failAudio = false;
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByText('Reconnecting to your room...', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.error && !audio.paused && audio.currentTime > 0)).toBe(true);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
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
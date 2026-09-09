import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProvider } from '../client/src/hooks/searchProvider.js';

test('provider searches surface HTTP errors and accept valid results', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502 }));
  await assert.rejects(searchProvider('saavn', 'night'), /unavailable/);
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ results: [{ name: 'Track' }] })));
  assert.deepEqual(await searchProvider('saavn', 'night'), [{ name: 'Track' }]);
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Upstream failed' })));
  await assert.rejects(searchProvider('audius', 'night'), /invalid/);
});

test('provider searches abort after fifteen seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(globalThis, 'fetch', async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
  }));
  const rejected = assert.rejects(searchProvider('youtube', 'night'), /aborted/);
  context.mock.timers.tick(15000);
  await rejected;
});
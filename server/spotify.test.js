import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotifyTokenHandler } from './spotify.js';

const body = { code: 'test-code', redirectUri: 'https://sonin.example/callback/spotify', codeVerifier: 'v'.repeat(64) };
const tokenResponse = () => Response.json({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 });

async function invoke(fetchImpl, requestBody = body, options = {}) {
  const result = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await createSpotifyTokenHandler({ fetchImpl, getClientId: () => 'test-client', ...options })({ body: requestBody }, result);
  return result;
}

test('Spotify exchanges PKCE and verifies account access before returning tokens', async () => {
  const calls = [];
  const result = await invoke(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? tokenResponse() : Response.json({});
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.accessToken, 'test-token');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(calls[0].options.body.get('code_verifier'), body.codeVerifier);
  assert.equal(calls[1].url, 'https://api.spotify.com/v1/me');
});

test('Spotify explains development allowlist denial without returning tokens', async () => {
  const result = await invoke(async url => url.includes('/api/token') ? tokenResponse() : new Response('', { status: 403 }));
  assert.equal(result.statusCode, 403);
  assert.match(result.body.error, /Users Management/);
  assert.equal(result.body.accessToken, undefined);
});

for (const phase of ['exchange', 'account']) {
  test(`Spotify bounds a stalled ${phase} request`, async () => {
    const result = await invoke(async (url, { signal }) => {
      if (phase === 'account' && url.includes('/api/token')) return tokenResponse();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }, body, { timeoutMs: 10 });
    assert.equal(result.statusCode, 504);
    assert.match(result.body.error, /did not respond in time/);
  });
}

test('Spotify handles expired codes, non-JSON errors, and rate limits', async () => {
  for (const response of [Response.json({ error: 'invalid_grant' }, { status: 400 }), new Response('<html>Unavailable</html>', { status: 502 }), new Response('', { status: 429 })]) {
    const status = response.status;
    const result = await invoke(async () => response);
    assert.equal(result.statusCode, status === 429 ? 429 : 502);
    assert.ok(result.body.error);
    assert.equal(result.body.accessToken, undefined);
  }
});

test('Spotify validates login details before contacting upstream', async () => {
  const result = await invoke(() => assert.fail('must not fetch'), {});
  assert.equal(result.statusCode, 400);
});
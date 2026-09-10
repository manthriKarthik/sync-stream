(async () => {
  const status = document.getElementById('spotify-status');
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const storageKey = `spotify_auth_${state}`;
  const controller = new AbortController();
  let timer;
  let verified = false;
  try {
    if (!window.opener || window.opener.closed) {
      throw new Error('The Sonin window is no longer available. Close this popup and connect again from your room.');
    }
    const stored = state && window.opener.sessionStorage.getItem(storageKey);
    const attempt = stored && JSON.parse(stored);
    if (!attempt || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
      throw new Error('This Spotify login has expired or does not match your room. Close this popup and connect again.');
    }
    verified = true;
    if (params.get('error')) throw new Error('Spotify authorization was declined. Please connect again and allow access.');
    const code = params.get('code');
    if (!code) throw new Error('Spotify did not return an authorization code. Please connect again.');
    history.replaceState(null, '', window.location.pathname);
    status.textContent = 'Connecting your Spotify account...';
    timer = setTimeout(() => controller.abort(), 25000);
    const response = await fetch('/api/platforms/spotify/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ code, redirectUri: attempt.redirectUri, codeVerifier: attempt.codeVerifier })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) {
      throw new Error(data.error || `Spotify connection failed (HTTP ${response.status}). Please reconnect from your room.`);
    }
    window.opener.postMessage({ type: 'spotify-token', state, token: data.accessToken }, window.location.origin);
    status.textContent = 'Account authorized. Return to Sonin while the Spotify player connects.';
    window.close();
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Spotify connection timed out. Close this popup and connect again. The server may be waking up or Spotify may be unreachable.'
      : error.message;
    status.setAttribute('role', 'alert');
    status.textContent = message;
    if (verified && window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'spotify-auth-error', state, message }, window.location.origin);
    }
  } finally {
    clearTimeout(timer);
    if (verified) window.opener?.sessionStorage.removeItem(storageKey);
  }
})();
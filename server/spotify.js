export function createSpotifyTokenHandler({ fetchImpl = fetch, timeoutMs = 15000, getClientId = () => process.env.SPOTIFY_CLIENT_ID } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const clientId = getClientId();
    if (!clientId) return res.status(503).json({ error: 'Spotify is not configured on this server.' });
    const { code, redirectUri, codeVerifier } = req.body || {};
    if (typeof code !== 'string' || !code || typeof redirectUri !== 'string' ||
        typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
      return res.status(400).json({ error: 'Spotify login details are missing or expired. Please connect again.' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        if (controller.signal.aborted) throw new Error('timeout');
        const message = data.error === 'invalid_grant'
          ? 'Spotify login expired or was already used. Close the popup and connect again.'
          : data.error === 'invalid_client'
            ? 'Spotify app configuration was rejected. The app owner must check SPOTIFY_CLIENT_ID and the registered redirect URI.'
            : `Spotify token exchange failed (HTTP ${response.status}). Please connect again.`;
        return res.status(response.status === 429 ? 429 : 502).json({ error: message });
      }
      const account = await fetchImpl('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: controller.signal
      });
      if (account.status === 403) {
        return res.status(403).json({ error: 'Spotify denied this account access to Sonin. If this app is in Development Mode, its owner must add your Spotify email in Spotify Developer Dashboard > Settings > Users Management. Premium alone does not grant app access. Then connect again.' });
      }
      if (!account.ok) return res.status(account.status === 429 ? 429 : 502).json({ error: `Spotify account verification failed (HTTP ${account.status}). Please connect again.` });
      res.json({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in });
    } catch {
      res.status(controller.signal.aborted ? 504 : 502).json({
        error: controller.signal.aborted
          ? 'Spotify did not respond in time. Please connect again.'
          : 'The server could not reach Spotify. Please connect again shortly.'
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
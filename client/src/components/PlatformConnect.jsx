import { useState, useCallback, useRef, useEffect } from 'react';
import { Music2, X } from 'lucide-react';
import Upload from './Upload';
import PlatformLogo from './PlatformLogo';

const TABS = [
  { id: 'audius', label: 'Audius' },
  { id: 'saavn', label: 'Saavn' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'upload', label: 'Upload' }
];

function PlatformConnect({ spotify, youtube, audius, saavn, soundcloud, roomId, userId, onTrackSelected, canControl, queueEmpty, connected }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addedIds, setAddedIds] = useState(() => new Set());
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('audius');
  const [showPanel, setShowPanel] = useState(true);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const searchIdRef = useRef(0);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [spotifyAuthError, setSpotifyAuthError] = useState('');
  const [spotifyAuthorizing, setSpotifyAuthorizing] = useState(false);
  const authCleanupRef = useRef(null);
  const spotifyConnectRef = useRef(spotify.connect);
  spotifyConnectRef.current = spotify.connect;
  useEffect(() => () => authCleanupRef.current?.(), []);

  const performSearch = useCallback(async (query) => {
    if (!query || !query.trim()) return;
    const searchId = ++searchIdRef.current;
    setSearchError('');
    setSearched(false);
    setSearching(true);
    setSearchResults([]);
    try {
      let results = [];
      if (activeTab === 'audius') {
        results = await audius.searchTracks(query);
      } else if (activeTab === 'saavn') {
        results = await saavn.searchTracks(query);
      } else if (activeTab === 'soundcloud') {
        results = await soundcloud.searchTracks(query);
      } else if (activeTab === 'youtube') {
        results = await youtube.searchTracks(query);
      } else if (activeTab === 'spotify' && spotify.isConnected) {
        results = await spotify.searchTracks(query);
      }
      if (searchId === searchIdRef.current) {
        setSearchResults(results || []);
        setSearched(true);
      }
    } catch (err) {
      console.error('Search failed:', err);
      if (searchId === searchIdRef.current) setSearchError('Search unavailable. Please try again.');
    } finally {
      if (searchId === searchIdRef.current) setSearching(false);
    }
  }, [activeTab, spotify, youtube, audius, saavn, soundcloud]);

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    performSearch(searchQuery);
  }, [performSearch, searchQuery]);

  // Update the query; clearing the box also clears the results list.
  const handleSearchChange = (value) => {
    searchIdRef.current += 1;
    setSearching(false);
    setSearched(false);
    setSearchQuery(value);
    if (!value.trim()) setSearchResults([]);
  };

  const handleSelectTrack = (track) => {
    if (!connected) return;
    onTrackSelected(track);
    // Mark this song as added so the button shows a green "Added" state; the
    // user can still add it again via the "Add again" button.
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });
    // Keep search results visible so user can add more songs
    // Don't clear: setSearchResults([]);
    // Don't clear: setSearchQuery('');
  };

  // Add YouTube track by URL
  const handleYoutubeUrl = (e) => {
    e.preventDefault();
    if (!connected || !youtubeUrl.trim()) return;
    const videoId = youtube.extractVideoId(youtubeUrl.trim());
    if (videoId) {
      onTrackSelected({
        id: videoId,
        uri: videoId,
        name: `YouTube: ${videoId}`,
        artist: '',
        album: '',
        albumArt: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        duration: null,
        platform: 'youtube'
      });
      setYoutubeUrl('');
    } else {
      setSearchError('Enter a valid YouTube video URL.');
    }
  };

  // Spotify login using Authorization Code + PKCE (required by Spotify for new apps)
  const handleSpotifyLogin = async () => {
    authCleanupRef.current?.();
    setSpotifyAuthError('');
    const clientId = window.__SPOTIFY_CLIENT_ID;
    if (!clientId) {
      setSpotifyAuthError('Spotify is not configured. Ask the app owner to set SPOTIFY_CLIENT_ID.');
      return;
    }
    const popup = window.open('about:blank', 'spotify-auth', 'width=500,height=700');
    if (!popup) {
      setSpotifyAuthError('Allow popups for Sonin, then connect Spotify again.');
      return;
    }
    setSpotifyAuthorizing(true);
    let storageKey;
    let timer;
    let cancelled = false;
    let handleToken;
    const cleanup = () => {
      cancelled = true;
      clearInterval(timer);
      if (handleToken) window.removeEventListener('message', handleToken);
      if (storageKey) sessionStorage.removeItem(storageKey);
      if (!popup.closed) popup.close();
    };
    authCleanupRef.current = cleanup;

    // Generate PKCE code verifier (random 64-char string)
    const generateVerifier = () => {
      const arr = new Uint8Array(64);
      crypto.getRandomValues(arr);
      return Array.from(arr, b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
    };

    // SHA-256 hash, base64url encoded
    const generateChallenge = async (verifier) => {
      const data = new TextEncoder().encode(verifier);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    try {
      const codeVerifier = generateVerifier();
      const codeChallenge = await generateChallenge(codeVerifier);
      if (cancelled) return;
      const state = generateVerifier();
      storageKey = `spotify_auth_${state}`;
      const redirectUri = `${window.location.origin}/callback/spotify`;
      sessionStorage.setItem(storageKey, JSON.stringify({ codeVerifier, redirectUri, createdAt: Date.now() }));
      const scopes = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
      const query = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: scopes, code_challenge_method: 'S256', code_challenge: codeChallenge, state });
      handleToken = (event) => {
        if (event.origin !== window.location.origin || event.source !== popup || event.data?.state !== state) return;
        if (event.data.type !== 'spotify-token' && event.data.type !== 'spotify-auth-error') return;
        if (event.data.type === 'spotify-token' && typeof event.data.token === 'string') {
          spotifyConnectRef.current(event.data.token);
        } else {
          setSpotifyAuthError(event.data.message || 'Spotify authorization failed. Please try again.');
        }
        setSpotifyAuthorizing(false);
        cleanup();
      };
      window.addEventListener('message', handleToken);
      const started = Date.now();
      timer = setInterval(() => {
        if (popup.closed || Date.now() - started > 10 * 60 * 1000) {
          setSpotifyAuthorizing(false);
          setSpotifyAuthError('Spotify login was closed or expired. Please connect again.');
          cleanup();
        }
      }, 1000);
      popup.location.href = `https://accounts.spotify.com/authorize?${query}`;
    } catch {
      cleanup();
      setSpotifyAuthorizing(false);
      setSpotifyAuthError('Could not start Spotify login. Use HTTPS, allow popups and browser storage, then try again.');
    }
  };

  if (!showPanel) {
    return (
      <button
        className="btn btn-secondary"
        onClick={() => setShowPanel(true)}
        style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <Music2 size={18} />Add music
      </button>
    );
  }

  return (
    <section className="music-browser" aria-label="Music library">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="library-title"><Music2 size={19} />Find your sound</h2>
        <button
          className="btn-icon"
          onClick={() => setShowPanel(false)}
          aria-label="Close music library"
          title="Close music library"
          style={{ width: 28, height: 28, fontSize: 12 }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Platform tabs (with brand logos) */}
      <div className="platform-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`platform-tab ${activeTab === t.id ? 'active' : ''}`}
            aria-pressed={activeTab === t.id}
            onClick={() => {
              searchIdRef.current += 1;
              setActiveTab(t.id);
              setSearchResults([]);
              setSearching(false);
              setSearched(false);
              setSearchError('');
            }}
          >
            <span className="platform-tab-logo"><PlatformLogo platform={t.id} size={18} /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Audius - free, full songs, best sync */}
      {activeTab === 'audius' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
            ✓ Free • full songs • no login • perfectly synced
          </p>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Search Audius for music..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </form>
        </div>
      )}

      {/* Saavn - free full songs (huge Bollywood/Indian catalog), best for groups */}
      {activeTab === 'saavn' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
            ✓ Free • full songs • no login • plays on ALL devices + background
          </p>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Search songs (Hindi, English, Telugu, Tamil...)"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </form>
        </div>
      )}

      {/* SoundCloud - free, huge English catalog, direct streams (syncs for all) */}
      {activeTab === 'soundcloud' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
            ✓ Free • full songs • no login • great for English • plays on ALL devices
          </p>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Search SoundCloud (English, remixes, covers...)"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </form>
        </div>
      )}

      {/* YouTube - always available */}
      {activeTab === 'youtube' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
            ✓ No login required — works for everyone
          </p>

          {/* Paste URL */}
          <form onSubmit={handleYoutubeUrl} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Paste YouTube URL..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              style={{ fontSize: 12 }}
            />
            <button className="btn btn-secondary" type="submit" disabled={!connected} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
              + Add
            </button>
          </form>

          <div className="divider">or search</div>

          {/* Search */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Search YouTube for music..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </form>
        </div>
      )}

      {/* Spotify */}
      {activeTab === 'spotify' && (
        <div style={{ marginBottom: 16 }}>
          {spotify.isConnected ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ color: 'var(--success)', fontSize: 12 }}>● Connected to Spotify</span>
                <button className="btn btn-secondary" onClick={spotify.disconnect} style={{ fontSize: 11, padding: '4px 8px' }}>
                  Disconnect
                </button>
              </div>
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type="text"
                  placeholder="Search Spotify..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={searching}>
                  {searching ? '...' : '🔍'}
                </button>
              </form>
              <p style={{ fontSize: 11, color: '#f0ad4e', marginTop: 8, lineHeight: 1.5 }}>
                ⚠️ Spotify limitation: each device needs its OWN Spotify Premium account.
                Two devices on the SAME account can't play at once — playback will bounce
                between them. For group listening on multiple devices, use <b>Audius</b> or
                <b> YouTube</b> instead (no account needed, plays everywhere at once).
              </p>
            </div>
          ) : (
            <div>
              <button className="btn btn-primary" onClick={handleSpotifyLogin} disabled={spotifyAuthorizing || spotify.isConnecting} style={{ background: '#1DB954' }}>
                {spotifyAuthorizing ? 'Authorizing Spotify...' : spotify.isConnecting ? 'Connecting Spotify player...' : 'Connect Spotify (Premium required)'}
              </button>
              {(spotifyAuthError || spotify.error) && (
                <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{spotifyAuthError || spotify.error}</p>
              )}
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                Each listener needs Spotify Premium. Use YouTube if you don't have it.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload local file */}
      {activeTab === 'upload' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
            ✓ Play your own audio files • synced for everyone
          </p>
          <Upload roomId={roomId} userId={userId} connected={connected} />
        </div>
      )}

      {/* Search Results */}
      {searchError && <p className="form-error" role="alert">{searchError}</p>}
      {searched && !searching && searchResults.length === 0 && <p className="search-empty" role="status">No tracks found for "{searchQuery}".</p>}
      {activeTab !== 'upload' && searchResults.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 12 }}>
          {searchResults.map((track) => {
            const isAdded = addedIds.has(track.id);
            return (
            <div
              key={track.id}
              className="search-result-row"
              onClick={() => handleSelectTrack(track)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {track.albumArt && (
                <img
                  src={track.albumArt}
                  alt=""
                  style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {track.artist}{track.durationText ? ` • ${track.durationText}` : ''}
                </div>
              </div>
              {isAdded ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#000',
                      background: '#fff',
                      borderRadius: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    ✓ Added
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSelectTrack(track); }}
                    title="Add this song to the queue again"
                    disabled={!connected}
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Add again
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={(e) => { e.stopPropagation(); handleSelectTrack(track); }}
                  disabled={!connected}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                >
                  {queueEmpty && canControl ? '▶ Play' : '+ Add'}
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default PlatformConnect;

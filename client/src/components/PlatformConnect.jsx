import { useState, useCallback } from 'react';
import Upload from './Upload';

// Small inline brand logos shown beside each platform tab.
function AudiusLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#CC0FE0" />
      <path fill="#fff" d="M12 5l6 11h-3.4L12 10.8 9.4 16H6z" />
    </svg>
  );
}

function SaavnLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="saavnGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2BC5B4" />
          <stop offset="1" stopColor="#1E9E8F" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#saavnGrad)" />
      <path fill="#fff" d="M14.5 6v7.6a2.6 2.6 0 1 1-1.5-2.4V8.2l-4 1v5.2a2.6 2.6 0 1 1-1.5-2.4V8.5z" />
    </svg>
  );
}

function YouTubeLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.1 31.1 0 0 0 0 12a31.1 31.1 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.1 31.1 0 0 0 24 12a31.1 31.1 0 0 0-.5-5.8z" />
      <path fill="#fff" d="M9.6 15.6V8.4l6.2 3.6z" />
    </svg>
  );
}

function SpotifyLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1DB954" />
      <path fill="#000" d="M17.6 10.9C14.6 9.1 9.6 8.9 6.7 9.8a.9.9 0 1 1-.5-1.7c3.3-1 8.8-.8 12.2 1.3a.9.9 0 0 1-.8 1.5zm-.1 2.7c-.3.4-.7.6-1.1.3-2.5-1.5-6.3-2-9.2-1.1a.75.75 0 0 1-.4-1.4c3.4-1 7.6-.5 10.5 1.3.3.2.4.6.2 1zm-1.2 2.5c-.2.3-.5.4-.8.2-2.2-1.3-4.9-1.6-8.1-.9a.63.63 0 1 1-.3-1.2c3.5-.8 6.5-.4 9 1.1.3.2.4.5.2.8z" />
    </svg>
  );
}

function UploadLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#6366f1" />
      <path fill="#fff" d="M12 6l4 4h-2.5v4h-3v-4H8z" />
      <rect x="7.5" y="16" width="9" height="1.8" rx="0.9" fill="#fff" />
    </svg>
  );
}

const TABS = [
  { id: 'audius', label: 'Audius', logo: <AudiusLogo /> },
  { id: 'saavn', label: 'Saavn', logo: <SaavnLogo /> },
  { id: 'youtube', label: 'YouTube', logo: <YouTubeLogo /> },
  { id: 'spotify', label: 'Spotify', logo: <SpotifyLogo /> },
  { id: 'upload', label: 'Upload', logo: <UploadLogo /> }
];

function PlatformConnect({ spotify, youtube, audius, saavn, roomId, userId, onTrackSelected, canControl }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('audius');
  const [showPanel, setShowPanel] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);

    try {
      let results = [];
      if (activeTab === 'audius') {
        results = await audius.searchTracks(searchQuery);
      } else if (activeTab === 'saavn') {
        results = await saavn.searchTracks(searchQuery);
      } else if (activeTab === 'youtube') {
        results = await youtube.searchTracks(searchQuery);
      } else if (activeTab === 'spotify' && spotify.isConnected) {
        results = await spotify.searchTracks(searchQuery);
      }
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, activeTab, spotify, youtube, audius, saavn]);

  const handleSelectTrack = (track) => {
    onTrackSelected(track);
    // Keep search results visible so user can add more songs
    // Don't clear: setSearchResults([]);
    // Don't clear: setSearchQuery('');
  };

  // Add YouTube track by URL
  const handleYoutubeUrl = (e) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;
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
      alert('Invalid YouTube URL. Try pasting a full link like https://youtube.com/watch?v=...');
    }
  };

  // Spotify login using Authorization Code + PKCE (required by Spotify for new apps)
  const handleSpotifyLogin = async () => {
    const clientId = window.__SPOTIFY_CLIENT_ID;
    if (!clientId) {
      alert('Spotify Client ID not configured. Ask the room host to set it up.');
      return;
    }

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

    const codeVerifier = generateVerifier();
    const codeChallenge = await generateChallenge(codeVerifier);

    // Store verifier for the callback to use
    sessionStorage.setItem('spotify_code_verifier', codeVerifier);

    const redirectUri = `${window.location.origin}/callback/spotify`;
    const scopes = 'streaming user-read-email user-read-private user-modify-playback-state';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&code_challenge_method=S256&code_challenge=${codeChallenge}`;
    
    const popup = window.open(authUrl, 'spotify-auth', 'width=500,height=700');
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'spotify-token') {
        spotify.connect(event.data.token);
        popup?.close();
      }
    }, { once: true });
  };

  if (!showPanel) {
    return (
      <button
        className="btn btn-secondary"
        onClick={() => setShowPanel(true)}
        style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        🎵 Add Music &amp; Upload Files
      </button>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: 20,
      marginBottom: 20
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14 }}>🎵 Add Music</h3>
        <button
          className="btn-icon"
          onClick={() => setShowPanel(false)}
          style={{ width: 28, height: 28, fontSize: 12 }}
        >
          ✕
        </button>
      </div>

      {/* Platform tabs (with brand logos) */}
      <div className="platform-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`platform-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="platform-tab-logo">{t.logo}</span>
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
            <button className="btn btn-secondary" type="submit" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
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
              onChange={(e) => setSearchQuery(e.target.value)}
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
                  onChange={(e) => setSearchQuery(e.target.value)}
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
              <button className="btn btn-primary" onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>
                Connect Spotify (Premium required)
              </button>
              {spotify.error && (
                <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{spotify.error}</p>
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
          <Upload roomId={roomId} userId={userId} />
        </div>
      )}

      {/* Search Results */}
      {activeTab !== 'upload' && searchResults.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 12 }}>
          {searchResults.map((track) => (
            <div
              key={track.id}
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
              <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }}>
                + Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlatformConnect;

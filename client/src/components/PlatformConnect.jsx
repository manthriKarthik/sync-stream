import { useState, useCallback } from 'react';

function PlatformConnect({ spotify, appleMusic, onTrackSelected, canControl }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('spotify');
  const [showPanel, setShowPanel] = useState(false);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);

    try {
      let results = [];
      if (activeTab === 'spotify' && spotify.isConnected) {
        results = await spotify.searchTracks(searchQuery);
      } else if (activeTab === 'apple' && appleMusic.isConnected) {
        results = await appleMusic.searchTracks(searchQuery);
      }
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, activeTab, spotify, appleMusic]);

  const handleSelectTrack = (track) => {
    onTrackSelected(track);
    setSearchResults([]);
    setSearchQuery('');
  };

  // Spotify login URL (user needs to set up their own Spotify app)
  const handleSpotifyLogin = () => {
    const clientId = window.__SPOTIFY_CLIENT_ID;
    if (!clientId) {
      alert('Spotify Client ID not configured. Set it in Settings.');
      return;
    }
    const redirectUri = `${window.location.origin}/callback/spotify`;
    const scopes = 'streaming user-read-email user-read-private user-modify-playback-state';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    
    // Open popup for auth
    const popup = window.open(authUrl, 'spotify-auth', 'width=500,height=700');
    
    // Listen for token from popup
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
        🎵 Connect Streaming Platform
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
        <h3 style={{ fontSize: 14 }}>🎵 Streaming Platforms</h3>
        <button
          className="btn-icon"
          onClick={() => setShowPanel(false)}
          style={{ width: 28, height: 28, fontSize: 12 }}
        >
          ✕
        </button>
      </div>

      {/* Platform tabs */}
      <div className="mode-toggle" style={{ marginBottom: 16 }}>
        <button
          className={activeTab === 'spotify' ? 'active' : ''}
          onClick={() => setActiveTab('spotify')}
        >
          Spotify
        </button>
        <button
          className={activeTab === 'apple' ? 'active' : ''}
          onClick={() => setActiveTab('apple')}
        >
          Apple Music
        </button>
      </div>

      {/* Connection status */}
      {activeTab === 'spotify' && (
        <div style={{ marginBottom: 16 }}>
          {spotify.isConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--success)', fontSize: 12 }}>● Connected to Spotify</span>
              <button className="btn btn-secondary" onClick={spotify.disconnect} style={{ fontSize: 11, padding: '4px 8px' }}>
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button className="btn btn-primary" onClick={handleSpotifyLogin} style={{ background: '#1DB954' }}>
                Connect Spotify (Premium required)
              </button>
              {spotify.error && (
                <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{spotify.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'apple' && (
        <div style={{ marginBottom: 16 }}>
          {appleMusic.isConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--success)', fontSize: 12 }}>● Connected to Apple Music</span>
              <button className="btn btn-secondary" onClick={appleMusic.disconnect} style={{ fontSize: 11, padding: '4px 8px' }}>
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button className="btn btn-primary" onClick={appleMusic.authorize} style={{ background: '#fc3c44' }}>
                Connect Apple Music (Subscription required)
              </button>
              {appleMusic.error && (
                <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{appleMusic.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      {((activeTab === 'spotify' && spotify.isConnected) ||
        (activeTab === 'apple' && appleMusic.isConnected)) && canControl && (
        <div>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder={`Search ${activeTab === 'spotify' ? 'Spotify' : 'Apple Music'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </form>

          {/* Results */}
          {searchResults.length > 0 && (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
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
                      style={{ width: 40, height: 40, borderRadius: 4 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {track.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {track.artist} • {track.album}
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
      )}

      {/* Info for unconnected */}
      {((activeTab === 'spotify' && !spotify.isConnected) ||
        (activeTab === 'apple' && !appleMusic.isConnected)) && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Connect your account to search and sync songs. Each listener needs their own subscription.
          Everyone hears the same song from their own account — perfectly synced.
        </p>
      )}
    </div>
  );
}

export default PlatformConnect;

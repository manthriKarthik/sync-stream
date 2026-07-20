import { useState, useCallback } from 'react';

function PlatformConnect({ spotify, youtube, onTrackSelected, canControl }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState('youtube');
  const [showPanel, setShowPanel] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);

    try {
      let results = [];
      if (activeTab === 'youtube') {
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
  }, [searchQuery, activeTab, spotify, youtube]);

  const handleSelectTrack = (track) => {
    onTrackSelected(track);
    setSearchResults([]);
    setSearchQuery('');
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

  // Spotify login
  const handleSpotifyLogin = () => {
    const clientId = window.__SPOTIFY_CLIENT_ID;
    if (!clientId) {
      alert('Spotify Client ID not configured. Ask the room host to set it up.');
      return;
    }
    const redirectUri = `${window.location.origin}/callback/spotify`;
    const scopes = 'streaming user-read-email user-read-private user-modify-playback-state';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    
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
        🎵 Search Music (YouTube / Spotify)
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
        <h3 style={{ fontSize: 14 }}>🎵 Music Search</h3>
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
          className={activeTab === 'youtube' ? 'active' : ''}
          onClick={() => setActiveTab('youtube')}
        >
          ▶ YouTube
        </button>
        <button
          className={activeTab === 'spotify' ? 'active' : ''}
          onClick={() => setActiveTab('spotify')}
        >
          🟢 Spotify
        </button>
      </div>

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
          {canControl && (
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
          )}
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
              {canControl && (
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
              )}
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

      {/* Search Results */}
      {searchResults.length > 0 && (
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

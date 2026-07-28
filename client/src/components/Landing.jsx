import { useState } from 'react';

function Landing({ onCreateRoom, onJoinRoom, connected }) {
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'

  const handleCreate = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onCreateRoom(roomName.trim(), username.trim());
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!username.trim() || !roomCode.trim()) return;
    // Normalize to lowercase for case-insensitive matching
    onJoinRoom(roomCode.trim().toLowerCase(), username.trim());
  };

  // Interactive spotlight + subtle 3D tilt that follows the cursor
  const handleCardMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rx = ((y / rect.height) - 0.5) * -6;
    const ry = ((x / rect.width) - 0.5) * 6;
    card.style.setProperty('--mx', `${x}px`);
    card.style.setProperty('--my', `${y}px`);
    card.style.setProperty('--rx', `${rx}deg`);
    card.style.setProperty('--ry', `${ry}deg`);
  };

  const handleCardLeave = (e) => {
    const card = e.currentTarget;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  };

  return (
    <div className="landing">
      <div
        className="landing-card"
        onMouseMove={handleCardMove}
        onMouseLeave={handleCardLeave}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#0a0a0a">
              <rect x="2" y="9" width="3" height="6" rx="1.5" />
              <rect x="7" y="5.5" width="3" height="13" rx="1.5" />
              <rect x="12" y="2" width="3" height="20" rx="1.5" />
              <rect x="17" y="7" width="3" height="10" rx="1.5" />
            </svg>
          </span>
          <h1>Sonin</h1>
        </div>
        <p>Listen together in perfect sync. Create a room, invite friends, and enjoy music through your own earbuds.</p>

        <div className="feature-pills">
          {['🎧 Zero-latency sync', '💬 Live chat', '👑 Host controls'].map((f) => (
            <span key={f} className="feature-pill">
              {f}
            </span>
          ))}
        </div>

        <div className="form-group">
          <label>Your Name</label>
          <input
            className="input"
            type="text"
            placeholder="Enter your name..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
          />
        </div>

        <div className="mode-toggle" style={{ marginBottom: 20 }}>
          <button
            className={mode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
          >
            Create Room
          </button>
          <button
            className={mode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
          >
            Join Room
          </button>
        </div>

        {mode === 'create' ? (
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Room Name (optional)</label>
              <input
                className="input"
                type="text"
                placeholder="My Listening Party"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={30}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={!username.trim() || !connected}
            >
              {connected ? 'Create Room' : 'Connecting...'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <div className="form-group">
              <label>Room Code</label>
              <input
                className="input"
                type="text"
                placeholder="Enter room code..."
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                maxLength={8}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={!username.trim() || !roomCode.trim() || !connected}
            >
              {connected ? 'Join Room' : 'Connecting...'}
            </button>
          </form>
        )}

        {!connected && (
          <p style={{ marginTop: 12, color: 'var(--danger)', fontSize: 12 }}>
            ⚠ Connecting to server...
          </p>
        )}
      </div>
    </div>
  );
}

export default Landing;

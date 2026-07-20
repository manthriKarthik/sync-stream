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
    onJoinRoom(roomCode.trim(), username.trim());
  };

  return (
    <div className="landing">
      <div className="landing-card">
        <h1>🎵 SyncStream</h1>
        <p>Listen together in perfect sync. Create a room, invite friends, and enjoy music through your own earbuds.</p>

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

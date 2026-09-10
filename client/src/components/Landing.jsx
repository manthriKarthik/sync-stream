import { useState } from 'react';
import { ArrowRight, AudioLines, Plus, Users } from 'lucide-react';
import ArtistShowcase from './ArtistShowcase';
import ImageLicenses from './ImageLicenses';
import SoninLogo from './SoninLogo';

function Landing({ onCreateRoom, onJoinRoom, connected, pending, error }) {
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'

  const handleCreate = (e) => {
    e.preventDefault();
    if (!connected || pending || !username.trim()) return;
    onCreateRoom(roomName.trim(), username.trim());
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!connected || pending || !username.trim() || !roomCode.trim()) return;
    // Normalize to lowercase for case-insensitive matching
    onJoinRoom(roomCode.trim().toLowerCase(), username.trim());
  };

  return (
    <main className="studio-entry">
      <header className="entry-header">
        <a className="studio-brand" href="/" aria-label="Sonin home"><SoninLogo /></a>
        <span className={`connection-status ${connected ? 'online' : ''}`} role="status"><span />{connected ? 'Ready to connect' : 'Connecting to server'}</span>
      </header>
      <div className="entry-content">
        <ArtistShowcase />
        <div className="entry-workspace">
          <section id="room-access" className="entry-form-area" aria-label="Room access">
            <div className="room-access-heading"><span className="eyebrow">MAKE IT A SHARED MOMENT</span><h2>Your room. Your people. Your music.</h2></div>
            <div className="entry-tabs" role="group" aria-label="Room action">
              <button type="button" aria-pressed={mode === 'create'} className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')} disabled={pending}><Plus size={17} />Create a room</button>
              <button type="button" aria-pressed={mode === 'join'} className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')} disabled={pending}><Users size={17} />Join a room</button>
            </div>
            <form onSubmit={mode === 'create' ? handleCreate : handleJoin} className="entry-form">
              <div className="form-group">
                <label htmlFor="listener-name">Your name</label>
                <input id="listener-name" className="input" autoComplete="nickname" placeholder="What should we call you?" value={username} onChange={event => setUsername(event.target.value)} maxLength={20} required disabled={pending} />
              </div>
              {mode === 'create' ? (
                <div className="form-group">
                  <label htmlFor="room-name">Room name <span>optional</span></label>
                  <input id="room-name" className="input" placeholder="Late night listening" value={roomName} onChange={event => setRoomName(event.target.value)} maxLength={30} disabled={pending} />
                </div>
              ) : (
                <div className="form-group">
                  <label htmlFor="room-code">Room code</label>
                  <input id="room-code" className="input code-input" placeholder="8-character code" value={roomCode} onChange={event => setRoomCode(event.target.value)} maxLength={8} autoCapitalize="none" spellCheck={false} required disabled={pending} />
                </div>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="btn btn-primary entry-submit" type="submit" disabled={!connected || pending || !username.trim() || (mode === 'join' && !roomCode.trim())}>
                {pending ? 'Opening your room...' : mode === 'create' ? 'Create room' : 'Join room'}<ArrowRight size={19} />
              </button>
            </form>
          </section>
        </div>
      </div>
      <footer className="entry-footer"><span>A little closer. One song at a time.</span><ImageLicenses /><span><AudioLines size={16} />Made for listening together</span></footer>
    </main>
  );
}

export default Landing;

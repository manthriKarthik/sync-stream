import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import Landing from './components/Landing';
const Room = lazy(() => import('./components/Room'));

// A per-browser persistent identity. Unlike socket.id (which changes on every
// reconnect), this survives reloads/reconnects so the server can recognise the
// host and "my" chat messages after a break.
function getPersistentUserId() {
  try {
    let id = localStorage.getItem('sonin_uid');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `u_${Math.random().toString(36).slice(2)}${Date.now()}`;
      localStorage.setItem('sonin_uid', id);
    }
    return id;
  } catch {
    return `u_${Math.random().toString(36).slice(2)}${Date.now()}`;
  }
}

function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'room'
  const [roomState, setRoomState] = useState(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const requestTimerRef = useRef(null);
  const userIdRef = useRef(getPersistentUserId());
  // Remembers the current room so we can auto-rejoin after a reconnect.
  const sessionRef = useRef(null); // { roomId, username }
  // True only while a user-initiated join/create is in flight, so we can tell a
  // manual "wrong code" from a silent auto-rejoin that failed (e.g. the server
  // restarted and wiped the in-memory room).
  const manualJoinRef = useRef(false);

  const { socket, connected } = useSocket({
    onRoomState: (state) => {
      clearTimeout(requestTimerRef.current);
      setPending(false);
      setError('');
      manualJoinRef.current = false;
      setRoomState(state);
      setView('room');
      sessionRef.current = {
        roomId: state.id,
        username: sessionRef.current?.username || state.members?.find(m => m.userId === userIdRef.current)?.username
      };
    },
    onRoomCreated: (room) => {
      sessionRef.current = { roomId: room.id, username: sessionRef.current?.username };
    },
    onError: (error) => {
      clearTimeout(requestTimerRef.current);
      setPending(false);
      // An auto-rejoin that fails (room no longer exists on the server) should
      // NOT show the scary "check the code" popup — the user did nothing wrong.
      // Quietly send them back to the landing page instead.
      if (error?.code === 'ROOM_NOT_FOUND' && !manualJoinRef.current) {
        sessionRef.current = null;
        setRoomState(null);
        setView('landing');
        return;
      }
      if (manualJoinRef.current) sessionRef.current = null;
      manualJoinRef.current = false;
      setError(error?.message || 'Something went wrong. Please try again.');
    }
  });

  // Auto-rejoin the room whenever the socket (re)connects after we were already
  // in a room — this restores host controls and identity after a break.
  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      const s = sessionRef.current;
      if (s && s.roomId && s.username) {
        socket.emit('room:join', { roomId: s.roomId, username: s.username, userId: userIdRef.current });
      }
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [socket]);

  const beginRequest = () => {
    if (!socket?.connected || manualJoinRef.current) return false;
    manualJoinRef.current = true;
    setPending(true);
    setError('');
    requestTimerRef.current = setTimeout(() => {
      manualJoinRef.current = false;
      sessionRef.current = null;
      setPending(false);
      setError('The connection timed out. Please try again.');
    }, 10000);
    return true;
  };

  useEffect(() => () => clearTimeout(requestTimerRef.current), []);

  const handleCreateRoom = (name, user) => {
    if (!beginRequest()) return;
    setUsername(user);
    sessionRef.current = { username: user };
    socket.emit('room:create', { username: user, roomName: name, userId: userIdRef.current });
  };

  const handleJoinRoom = (roomId, user) => {
    if (!beginRequest()) return;
    setUsername(user);
    manualJoinRef.current = true;
    sessionRef.current = { roomId: roomId?.trim()?.toLowerCase(), username: user };
    socket.emit('room:join', { roomId, username: user, userId: userIdRef.current });
  };

  const handleLeaveRoom = () => {
    if (roomState) {
      if (socket?.connected) socket.emit('room:leave', { roomId: roomState.id });
      sessionRef.current = null;
      setRoomState(null);
      setView('landing');
    }
  };

  if (view === 'landing') {
    return (
      <div className="app">
        <Landing
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          connected={connected}
          pending={pending}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {error && <div className="room-notice" role="alert">{error}<button className="btn btn-secondary" onClick={() => setError('')}>Dismiss</button></div>}
      <Suspense fallback={<p className="room-notice" role="status">Opening your room...</p>}>
      <Room
        connected={connected && !!roomState?.members?.some(member => member.id === socket?.id)}
        socket={socket}
        roomState={roomState}
        setRoomState={setRoomState}
        username={username}
        userId={userIdRef.current}
        onLeave={handleLeaveRoom}
      />
      </Suspense>
    </div>
  );
}

export default App;

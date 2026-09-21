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

// The active room session survives a full page refresh so we can auto-rejoin
// instead of dropping the user back on the landing page.
function loadSession() {
  try {
    const raw = localStorage.getItem('sonin_session');
    const s = raw ? JSON.parse(raw) : null;
    return s && s.roomId && s.username ? s : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session && session.roomId && session.username) {
      localStorage.setItem('sonin_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('sonin_session');
    }
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

function App() {
  const restoredSessionRef = useRef(loadSession());
  const [view, setView] = useState('landing'); // 'landing' | 'room'
  const [roomState, setRoomState] = useState(null);
  const [username, setUsername] = useState(restoredSessionRef.current?.username || '');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const requestTimerRef = useRef(null);
  const userIdRef = useRef(getPersistentUserId());
  // Remembers the current room so we can auto-rejoin after a reconnect or a
  // full page refresh. Restored from localStorage so a reload rejoins the room.
  const sessionRef = useRef(restoredSessionRef.current); // { roomId, username }

  // Set the active session and mirror it to storage in one place.
  const setSession = (next) => {
    sessionRef.current = next;
    saveSession(next);
  };
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
      setSession({
        roomId: state.id,
        username: sessionRef.current?.username || state.members?.find(m => m.userId === userIdRef.current)?.username
      });
    },
    onRoomCreated: (room) => {
      setSession({ roomId: room.id, username: sessionRef.current?.username });
    },
    onError: (error) => {
      clearTimeout(requestTimerRef.current);
      setPending(false);
      // An auto-rejoin that fails (room no longer exists on the server) should
      // NOT show the scary "check the code" popup — the user did nothing wrong.
      // Quietly send them back to the landing page instead.
      if (error?.code === 'ROOM_NOT_FOUND' && !manualJoinRef.current) {
        setSession(null);
        setRoomState(null);
        setView('landing');
        return;
      }
      if (manualJoinRef.current) setSession(null);
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
    // The socket may already be connected before this effect runs (e.g. after a
    // page refresh), in which case the 'connect' event won't fire again.
    if (socket.connected) onConnect();
    return () => socket.off('connect', onConnect);
  }, [socket]);

  const beginRequest = () => {
    if (!socket?.connected || manualJoinRef.current) return false;
    manualJoinRef.current = true;
    setPending(true);
    setError('');
    requestTimerRef.current = setTimeout(() => {
      manualJoinRef.current = false;
      setSession(null);
      setPending(false);
      setError('The connection timed out. Please try again.');
    }, 10000);
    return true;
  };

  useEffect(() => () => clearTimeout(requestTimerRef.current), []);

  const handleCreateRoom = (name, user) => {
    if (!beginRequest()) return;
    setUsername(user);
    setSession({ username: user });
    socket.emit('room:create', { username: user, roomName: name, userId: userIdRef.current });
  };

  const handleJoinRoom = (roomId, user) => {
    if (!beginRequest()) return;
    setUsername(user);
    manualJoinRef.current = true;
    setSession({ roomId: roomId?.trim()?.toLowerCase(), username: user });
    socket.emit('room:join', { roomId, username: user, userId: userIdRef.current });
  };

  const handleLeaveRoom = () => {
    if (roomState) {
      if (socket?.connected) socket.emit('room:leave', { roomId: roomState.id });
      setSession(null);
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

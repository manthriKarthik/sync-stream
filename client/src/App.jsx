import { useState, useRef, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import Landing from './components/Landing';
import Room from './components/Room';

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
  const userIdRef = useRef(getPersistentUserId());
  // Remembers the current room so we can auto-rejoin after a reconnect.
  const sessionRef = useRef(null); // { roomId, username }

  const { socket, connected } = useSocket({
    onRoomState: (state) => {
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
      alert(error.message);
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

  const handleCreateRoom = (name, user) => {
    setUsername(user);
    sessionRef.current = { username: user };
    socket.emit('room:create', { username: user, roomName: name, userId: userIdRef.current });
  };

  const handleJoinRoom = (roomId, user) => {
    setUsername(user);
    sessionRef.current = { roomId: roomId?.trim()?.toLowerCase(), username: user };
    socket.emit('room:join', { roomId, username: user, userId: userIdRef.current });
  };

  const handleLeaveRoom = () => {
    if (roomState) {
      socket.emit('room:leave', { roomId: roomState.id });
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
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Room
        socket={socket}
        roomState={roomState}
        setRoomState={setRoomState}
        username={username}
        userId={userIdRef.current}
        onLeave={handleLeaveRoom}
      />
    </div>
  );
}

export default App;

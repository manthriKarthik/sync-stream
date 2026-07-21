import { useState, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import Landing from './components/Landing';
import Room from './components/Room';

function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'room'
  const [roomState, setRoomState] = useState(null);
  const [username, setUsername] = useState('');

  // Refs so the reconnect handler always sees the latest values.
  const roomStateRef = useRef(null);
  const usernameRef = useRef('');
  const isHostRef = useRef(false);
  roomStateRef.current = roomState;
  usernameRef.current = username;

  const { socket, connected } = useSocket({
    onRoomState: (state) => {
      setRoomState(state);
      setView('room');
    },
    onRoomCreated: (room) => {
      // Room created, wait for state
    },
    onError: (error) => {
      alert(error.message);
    },
    onReconnect: () => {
      // The server may have restarted (Render free tier wipes in-memory rooms).
      // Restore our room: the host recreates it with the same code, listeners rejoin.
      const room = roomStateRef.current;
      if (!room) return;
      if (isHostRef.current) {
        socket.emit('room:create', {
          username: usernameRef.current,
          roomName: room.name,
          existingId: room.id
        });
      } else {
        socket.emit('room:join', { roomId: room.id, username: usernameRef.current });
      }
    }
  });

  const handleCreateRoom = (name, user) => {
    setUsername(user);
    isHostRef.current = true;
    socket.emit('room:create', { username: user, roomName: name });
  };

  const handleJoinRoom = (roomId, user) => {
    setUsername(user);
    isHostRef.current = false;
    socket.emit('room:join', { roomId, username: user });
  };

  const handleLeaveRoom = () => {
    if (roomState) {
      socket.emit('room:leave', { roomId: roomState.id });
      isHostRef.current = false;
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
        onLeave={handleLeaveRoom}
      />
    </div>
  );
}

export default App;

import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import Landing from './components/Landing';
import Room from './components/Room';

function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'room'
  const [roomState, setRoomState] = useState(null);
  const [username, setUsername] = useState('');

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
    }
  });

  const handleCreateRoom = (name, user) => {
    setUsername(user);
    socket.emit('room:create', { username: user, roomName: name });
  };

  const handleJoinRoom = (roomId, user) => {
    setUsername(user);
    socket.emit('room:join', { roomId, username: user });
  };

  const handleLeaveRoom = () => {
    if (roomState) {
      socket.emit('room:leave', { roomId: roomState.id });
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

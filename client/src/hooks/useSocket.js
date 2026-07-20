import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useSocket({ onRoomState, onRoomCreated, onError }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to the same origin serving the page (routed via Vite proxy).
    // This works over LAN and public tunnels through a single port.
    // Polling first is the most reliable transport through tunnels.
    const socket = io({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room:state', (state) => onRoomState(state));
    socket.on('room:created', (room) => onRoomCreated(room));
    socket.on('error', (err) => onError(err));

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    socket: socketRef.current,
    connected
  };
}

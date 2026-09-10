import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useSocket({ onRoomState, onRoomCreated, onError }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const callbacksRef = useRef({ onRoomState, onRoomCreated, onError });
  callbacksRef.current = { onRoomState, onRoomCreated, onError };

  useEffect(() => {
    // Connect to the same origin serving the page (routed via Vite proxy).
    // This works over LAN and public tunnels through a single port.
    // Polling first is the most reliable transport through tunnels.
    const socket = io({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      autoConnect: navigator.onLine
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room:state', (state) => callbacksRef.current.onRoomState(state));
    socket.on('room:created', (room) => callbacksRef.current.onRoomCreated(room));
    socket.on('error', (err) => callbacksRef.current.onError(err));

    const handleOffline = () => {
      setConnected(false);
      socket.disconnect();
    };
    const handleOnline = () => socket.connect();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      socket.disconnect();
    };
  }, []);

  return {
    socket: socketRef.current,
    connected
  };
}

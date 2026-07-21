import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useSocket({ onRoomState, onRoomCreated, onError, onReconnect }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const hasConnectedRef = useRef(false);

  // Keep the latest callbacks without re-running the connect effect.
  const handlersRef = useRef({ onRoomState, onRoomCreated, onError, onReconnect });
  handlersRef.current = { onRoomState, onRoomCreated, onError, onReconnect };

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

    socket.on('connect', () => {
      setConnected(true);
      // On a *re*connect (e.g. after the server restarted/woke up), let the app
      // re-establish its room so in-memory rooms are restored.
      if (hasConnectedRef.current) {
        handlersRef.current.onReconnect?.();
      }
      hasConnectedRef.current = true;
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('room:state', (state) => handlersRef.current.onRoomState(state));
    socket.on('room:created', (room) => handlersRef.current.onRoomCreated(room));
    socket.on('error', (err) => handlersRef.current.onError(err));

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    socket: socketRef.current,
    connected
  };
}

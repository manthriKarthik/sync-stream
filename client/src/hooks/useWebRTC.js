import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * WebRTC hook for live audio streaming (mic/aux capture from host to listeners).
 * Uses peer-to-peer connections for minimum latency.
 */
export function useWebRTC(socket, roomId, isHost) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Start capturing audio from microphone/aux
  const startCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0
        },
        video: false
      });

      localStreamRef.current = stream;
      setIsStreaming(true);
      return stream;
    } catch (err) {
      console.error('Failed to capture audio:', err);
      throw err;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    setIsStreaming(false);
  }, []);

  // Create peer connection to a specific listener
  const createPeerConnection = useCallback((targetId) => {
    const pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks if we're the host streaming
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Handle incoming tracks (for listeners)
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice-candidate', {
          targetId,
          candidate: event.candidate
        });
      }
    };

    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, [socket]);

  // Host: create offer and send to new listener
  const sendOffer = useCallback(async (targetId) => {
    const pc = createPeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('webrtc:offer', {
      roomId,
      targetId,
      offer: pc.localDescription
    });
  }, [socket, roomId, createPeerConnection]);

  // Listener: handle incoming offer
  useEffect(() => {
    if (!socket) return;

    const handleOffer = async ({ fromId, offer }) => {
      const pc = createPeerConnection(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc:answer', {
        targetId: fromId,
        answer: pc.localDescription
      });
    };

    const handleAnswer = async ({ fromId, answer }) => {
      const pc = peerConnectionsRef.current.get(fromId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ fromId, candidate }) => {
      const pc = peerConnectionsRef.current.get(fromId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
    };
  }, [socket, createPeerConnection]);

  return {
    isStreaming,
    remoteStream,
    startCapture,
    stopCapture,
    sendOffer
  };
}

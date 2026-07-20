import { useState, useEffect, useCallback } from 'react';
import { useAudioSync } from '../hooks/useAudioSync';
import { useWebRTC } from '../hooks/useWebRTC';
import Player from './Player';
import Queue from './Queue';
import Members from './Members';
import Upload from './Upload';
import LiveCapture from './LiveCapture';

function Room({ socket, roomState, setRoomState, username, onLeave }) {
  const [queue, setQueue] = useState(roomState?.queue || []);
  const [members, setMembers] = useState(roomState?.members || []);
  const [mode, setMode] = useState(roomState?.mode || 'host');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(
    roomState?.playbackState?.trackIndex || 0
  );

  const isHost = roomState?.hostId === socket?.id;

  const {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    loadTrack,
    play,
    pause,
    seek,
    setVolume,
    clockOffset
  } = useAudioSync(socket);

  const {
    isStreaming,
    remoteStream,
    startCapture,
    stopCapture,
    sendOffer
  } = useWebRTC(socket, roomState?.id, isHost);

  // Listen for room updates
  useEffect(() => {
    if (!socket) return;

    const handleQueueUpdate = (newQueue) => setQueue(newQueue);
    const handleMemberJoined = (member) => {
      setMembers(prev => [...prev, member]);
      // If host is streaming, send offer to new member
      if (isHost && isStreaming) {
        sendOffer(member.id);
      }
    };
    const handleMemberLeft = ({ id }) => {
      setMembers(prev => prev.filter(m => m.id !== id));
    };
    const handleModeChanged = (newMode) => setMode(newMode);
    const handleHostChanged = ({ newHostId }) => {
      setRoomState(prev => ({ ...prev, hostId: newHostId }));
    };

    const handlePlaybackSync = (state) => {
      if (state.trackIndex !== currentTrackIndex && queue[state.trackIndex]) {
        setCurrentTrackIndex(state.trackIndex);
        loadTrack(queue[state.trackIndex].url);
      }
    };

    socket.on('queue:updated', handleQueueUpdate);
    socket.on('room:member-joined', handleMemberJoined);
    socket.on('room:member-left', handleMemberLeft);
    socket.on('room:mode-changed', handleModeChanged);
    socket.on('room:host-changed', handleHostChanged);
    socket.on('playback:sync', handlePlaybackSync);

    return () => {
      socket.off('queue:updated', handleQueueUpdate);
      socket.off('room:member-joined', handleMemberJoined);
      socket.off('room:member-left', handleMemberLeft);
      socket.off('room:mode-changed', handleModeChanged);
      socket.off('room:host-changed', handleHostChanged);
      socket.off('playback:sync', handlePlaybackSync);
    };
  }, [socket, isHost, isStreaming, currentTrackIndex, queue]);

  // Load initial track
  useEffect(() => {
    if (queue.length > 0 && queue[currentTrackIndex]) {
      loadTrack(queue[currentTrackIndex].url);
    }
  }, [queue, currentTrackIndex, loadTrack]);

  const canControl = isHost || mode === 'collaborative';

  const handlePlay = () => {
    if (!canControl) return;
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: currentTrackIndex,
      position: currentTime
    });
  };

  const handlePause = () => {
    if (!canControl) return;
    socket.emit('playback:pause', { roomId: roomState.id });
  };

  const handleSeek = (time) => {
    if (!canControl) return;
    socket.emit('playback:seek', { roomId: roomState.id, position: time });
  };

  const handleNext = () => {
    if (!canControl || queue.length === 0) return;
    socket.emit('playback:next', { roomId: roomState.id });
  };

  const handlePrev = () => {
    if (!canControl || queue.length === 0) return;
    const prevIndex = currentTrackIndex === 0 ? queue.length - 1 : currentTrackIndex - 1;
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: prevIndex,
      position: 0
    });
  };

  const handleTrackSelect = (index) => {
    if (!canControl) return;
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: index,
      position: 0
    });
  };

  const handleModeChange = (newMode) => {
    if (!isHost) return;
    socket.emit('room:set-mode', { roomId: roomState.id, mode: newMode });
  };

  const handleRemoveTrack = (trackId) => {
    if (!canControl) return;
    socket.emit('queue:remove', { roomId: roomState.id, trackId });
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomState.id);
  };

  return (
    <div className="room-layout">
      {/* Header */}
      <div className="room-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>{roomState.name}</h2>
          <span className="room-code" onClick={copyRoomCode} title="Click to copy">
            📋 {roomState.id}
          </span>
        </div>
        <div className="room-meta">
          {isHost && (
            <div className="mode-toggle">
              <button
                className={mode === 'host' ? 'active' : ''}
                onClick={() => handleModeChange('host')}
              >
                DJ Mode
              </button>
              <button
                className={mode === 'collaborative' ? 'active' : ''}
                onClick={() => handleModeChange('collaborative')}
              >
                Collaborative
              </button>
            </div>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            🕐 Sync: {Math.round(clockOffset)}ms offset
          </span>
          <button className="btn btn-secondary" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="room-main">
        <Upload roomId={roomState.id} userId={socket?.id} />
        
        {isHost && (
          <LiveCapture
            isStreaming={isStreaming}
            onStartCapture={startCapture}
            onStopCapture={stopCapture}
          />
        )}

        <h3 style={{ marginBottom: 16, fontSize: 16 }}>Queue</h3>
        <Queue
          queue={queue}
          currentIndex={currentTrackIndex}
          onSelect={handleTrackSelect}
          onRemove={handleRemoveTrack}
          canControl={canControl}
        />
      </div>

      {/* Sidebar */}
      <div className="room-sidebar">
        <Members members={members} hostId={roomState.hostId} />
      </div>

      {/* Player bar */}
      <Player
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        currentTrack={queue[currentTrackIndex] || null}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onNext={handleNext}
        onPrev={handlePrev}
        onVolumeChange={setVolume}
        canControl={canControl}
        audioElement={audioRef.current}
      />
    </div>
  );
}

export default Room;

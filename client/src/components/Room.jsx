import { useState, useEffect, useCallback } from 'react';
import { useAudioSync } from '../hooks/useAudioSync';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSpotify } from '../hooks/useSpotify';
import { useYouTube } from '../hooks/useYouTube';
import { useAudius } from '../hooks/useAudius';
import Player from './Player';
import Queue from './Queue';
import Members from './Members';
import Upload from './Upload';
import LiveCapture from './LiveCapture';
import PlatformConnect from './PlatformConnect';

function Room({ socket, roomState, setRoomState, username, onLeave }) {
  const [queue, setQueue] = useState(roomState?.queue || []);
  const [members, setMembers] = useState(roomState?.members || []);
  const [mode, setMode] = useState(roomState?.mode || 'host');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(
    roomState?.playbackState?.trackIndex || 0
  );
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [spotifyActivated, setSpotifyActivated] = useState(false);

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

  const spotify = useSpotify();
  const youtube = useYouTube();
  const audius = useAudius();

  const {
    isStreaming,
    remoteStream,
    startCapture,
    stopCapture,
    sendOffer
  } = useWebRTC(socket, roomState?.id, isHost);

  // Handle adding a streaming platform track to the queue
  const handlePlatformTrackSelected = (track) => {
    // Add the platform track to the room queue via socket
    socket.emit('queue:add-platform-track', {
      roomId: roomState.id,
      track: {
        id: track.id,
        name: track.name,
        artist: track.artist,
        album: track.album,
        albumArt: track.albumArt,
        uri: track.uri,
        url: track.url || null, // Audius provides a direct stream URL
        duration: track.duration,
        platform: track.platform,
        addedBy: username
      }
    });
  };

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
        const nextTrack = queue[state.trackIndex];
        // Only feed the shared <audio> engine for direct-URL tracks (Audius /
        // uploads). YouTube/Spotify play through their own SDKs and must NOT
        // pollute the shared audio element or they interfere with each other.
        if (nextTrack.url && nextTrack.platform !== 'youtube' && nextTrack.platform !== 'spotify') {
          loadTrack(nextTrack.url);
        }
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

  // Load initial track (handles both local and platform tracks)
  useEffect(() => {
    if (queue.length > 0 && queue[currentTrackIndex]) {
      const track = queue[currentTrackIndex];
      if (track.platform === 'spotify' || track.platform === 'apple') {
        // Platform tracks are played via their respective SDKs
        // The sync event will trigger playback on each client
      } else if (track.url) {
        loadTrack(track.url);
      }
    }
  }, [queue, currentTrackIndex, loadTrack]);

  // Handle platform track sync (when server broadcasts play for a platform track)
  useEffect(() => {
    if (!socket) return;

    const handlePlatformSync = (state) => {
      const track = queue[state.trackIndex];
      if (!track) return;

      // Compute the correct playback position accounting for the coordination
      // buffer / clock offset so late starts still land at the right spot.
      const computePosition = () => {
        if (!state.playing) return state.position || 0;
        const syncedNow = Date.now() + (clockOffset || 0);
        const anchor = state.syncTime || state.startedAt || syncedNow;
        const elapsed = Math.max(0, (syncedNow - anchor) / 1000);
        return (state.position || 0) + elapsed;
      };

      if (track.platform === 'youtube') {
        if (state.playing) {
          youtube.playTrack(track.uri, computePosition());
        } else {
          youtube.pause();
        }
      } else if (track.platform === 'spotify' && spotify.isConnected) {
        if (state.playing) {
          spotify.playTrack(track.uri, computePosition() * 1000);
        } else {
          spotify.pause();
        }
      }
    };

    socket.on('playback:sync', handlePlatformSync);
    return () => socket.off('playback:sync', handlePlatformSync);
  }, [socket, queue, spotify, youtube, clockOffset]);

  // Poll the active platform player so the progress bar keeps moving for
  // YouTube/Spotify tracks (they don't use the shared <audio> element).
  const [platformProgress, setPlatformProgress] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track) return;

    let cancelled = false;
    let intervalId;

    if (track.platform === 'youtube') {
      intervalId = setInterval(() => {
        const t = youtube.getPosition();
        const d = youtube.getDuration();
        setPlatformProgress({
          time: t || 0,
          duration: d || (track.duration ? track.duration / 1000 : 0)
        });
      }, 250);
    } else if (track.platform === 'spotify') {
      intervalId = setInterval(async () => {
        const t = await spotify.getPosition();
        if (cancelled) return;
        setPlatformProgress({
          time: (t || 0) / 1000,
          duration: track.duration ? track.duration / 1000 : 0
        });
      }, 500);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [queue, currentTrackIndex, youtube, spotify]);

  const canControl = isHost || mode === 'collaborative';

  // YouTube/Spotify tracks report progress via their own players, not the shared <audio>
  const activeTrack = queue[currentTrackIndex] || null;
  const isPlatformTrack = activeTrack?.platform === 'youtube' || activeTrack?.platform === 'spotify';

  const handlePlay = () => {
    if (!canControl) return;
    // Unlock the Spotify SDK audio element on this device (must be in a gesture)
    spotify.activate();
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
    spotify.activate();
    socket.emit('playback:next', { roomId: roomState.id });
  };

  const handlePrev = () => {
    if (!canControl || queue.length === 0) return;
    spotify.activate();
    const prevIndex = currentTrackIndex === 0 ? queue.length - 1 : currentTrackIndex - 1;
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: prevIndex,
      position: 0
    });
  };

  const handleTrackSelect = (index) => {
    if (!canControl) return;
    spotify.activate();
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

  // Enable audio on mobile - must run from a user gesture to satisfy autoplay policies
  const handleEnableAudio = () => {
    // Unlock the local <audio> element
    try {
      const a = audioRef.current;
      if (a) {
        a.play().then(() => a.pause()).catch(() => {});
      }
    } catch (_) { /* ignore */ }
    // Unlock the YouTube IFrame player (applies any pending synced track)
    youtube.unlock();
    // Unlock the Spotify SDK audio element if already connected
    spotify.activate();
    setAudioEnabled(true);
  };

  // Explicitly activate the Spotify SDK audio element on this device.
  // Needed for listeners who never press Play themselves.
  // NOTE: we do NOT transfer playback here — on a shared Spotify account that
  // would steal the stream from the other device and cause playback to bounce.
  const handleActivateSpotify = () => {
    spotify.activate();
    setSpotifyActivated(true);
  };

  return (
    <div className="room-layout">
      {!audioEnabled && (
        <div
          onClick={handleEnableAudio}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(10,10,20,0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            textAlign: 'center',
            padding: 24
          }}
        >
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎧</div>
          <h2 style={{ margin: '0 0 8px', color: '#fff' }}>Tap to Join Audio</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 320 }}>
            Your phone requires one tap to allow synced music playback.
            Tap anywhere to start listening.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 20, fontSize: 18, padding: '12px 32px' }}
            onClick={handleEnableAudio}
          >
            ▶ Enable Audio
          </button>
        </div>
      )}
      {/* Spotify device activation prompt (each device must be unlocked by a tap) */}
      {audioEnabled && spotify.isConnected && !spotifyActivated && (
        <div
          style={{
            position: 'fixed',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            background: '#1db954',
            color: '#fff',
            borderRadius: 999,
            padding: '12px 24px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600
          }}
          onClick={handleActivateSpotify}
        >
          🔊 Tap to enable Spotify sound on this device
        </div>
      )}
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
        <PlatformConnect
          spotify={spotify}
          youtube={youtube}
          audius={audius}
          onTrackSelected={handlePlatformTrackSelected}
          canControl={canControl}
        />

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
        currentTime={isPlatformTrack ? platformProgress.time : currentTime}
        duration={isPlatformTrack ? platformProgress.duration : duration}
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

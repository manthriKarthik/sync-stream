import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioSync } from '../hooks/useAudioSync';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSpotify } from '../hooks/useSpotify';
import { useYouTube } from '../hooks/useYouTube';
import { useAudius } from '../hooks/useAudius';
import Player from './Player';
import Queue from './Queue';
import MembersPanel from './MembersPanel';
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

  // When a track finishes, only the HOST advances the queue. If every listener
  // emitted "next", 3+ people would skip multiple songs at once. The server
  // wraps back to the first track when the queue ends.
  const handleTrackEnded = useCallback(() => {
    if (!isHost) return;
    if (!socket || !roomState?.id) return;
    socket.emit('playback:next', { roomId: roomState.id });
  }, [isHost, socket, roomState?.id]);

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
  } = useAudioSync(socket, handleTrackEnded);

  const spotify = useSpotify();
  const youtube = useYouTube(handleTrackEnded);
  const audius = useAudius();

  // Latest playback state for platform tracks, so a listener "tap to play"
  // can resume at the correct synced position.
  const platformStateRef = useRef(null);
  // Sync we still need to apply once the queue arrives (a device that joins
  // mid-song can receive the sync before its queue is populated).
  const pendingPlatformRef = useRef(null);
  // Reactive flag: is the room currently playing a platform (YouTube/Spotify)
  // track? Used to decide whether to show the "tap to play" prompt.
  const [platformPlaying, setPlatformPlaying] = useState(false);
  const computePlatformPosition = (state) => {
    if (!state) return 0;
    if (!state.playing) return state.position || 0;
    const syncedNow = Date.now() + (clockOffset || 0);
    const anchor = state.syncTime || state.startedAt || syncedNow;
    const elapsed = Math.max(0, (syncedNow - anchor) / 1000);
    return (state.position || 0) + elapsed;
  };

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
    const handleKicked = () => {
      alert('You have been removed from the room by the host.');
      onLeave();
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
    socket.on('room:kicked', handleKicked);
    socket.on('playback:sync', handlePlaybackSync);

    return () => {
      socket.off('queue:updated', handleQueueUpdate);
      socket.off('room:member-joined', handleMemberJoined);
      socket.off('room:member-left', handleMemberLeft);
      socket.off('room:mode-changed', handleModeChanged);
      socket.off('room:host-changed', handleHostChanged);
      socket.off('room:kicked', handleKicked);
      socket.off('playback:sync', handlePlaybackSync);
    };
  }, [socket, isHost, isStreaming, currentTrackIndex, queue, onLeave]);

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
      // Always remember the latest state first — even if the queue hasn't
      // arrived on this device yet — so the progress bar keeps advancing and
      // we can apply playback the moment the queue is ready.
      platformStateRef.current = state;
      pendingPlatformRef.current = state;
      setPlatformPlaying(!!state.playing);

      const track = queue[state.trackIndex];
      if (!track) return; // queue not ready yet — applied by the effect below

      if (track.platform === 'youtube') {
        if (state.playing) {
          youtube.playTrack(track.uri, computePlatformPosition(state));
        } else {
          youtube.pause();
        }
      } else if (track.platform === 'spotify' && spotify.isConnected) {
        if (state.playing) {
          spotify.playTrack(track.uri, computePlatformPosition(state) * 1000);
        } else {
          spotify.pause();
        }
      }
    };

    socket.on('playback:sync', handlePlatformSync);
    return () => socket.off('playback:sync', handlePlatformSync);
  }, [socket, queue, spotify, youtube, clockOffset]);

  // Apply any pending platform playback once the queue/track becomes available.
  // Fixes a device (2nd/3rd listener) that joined mid-song and received the
  // sync before its queue had loaded — previously it stayed silent with a
  // frozen progress bar and no "tap to play" prompt.
  useEffect(() => {
    const state = pendingPlatformRef.current;
    if (!state || !state.playing) return;
    const track = queue[state.trackIndex];
    if (!track) return;
    if (track.platform === 'youtube') {
      youtube.playTrack(track.uri, computePlatformPosition(state));
    } else if (track.platform === 'spotify' && spotify.isConnected) {
      spotify.playTrack(track.uri, computePlatformPosition(state) * 1000);
    }
  }, [queue, currentTrackIndex, spotify.isConnected, youtube]);

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
        let t = youtube.getPosition();
        const d = youtube.getDuration();
        // If this device's YouTube player isn't reporting a position (blocked
        // autoplay, backgrounded, etc.), fall back to the synced clock so the
        // progress bar still moves for everyone.
        if ((!t || t <= 0) && platformStateRef.current?.playing) {
          t = computePlatformPosition(platformStateRef.current);
        }
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

  // Keep YouTube aligned across devices. YouTube players start slightly apart
  // and drift over time, so periodically re-seek to the synced position when
  // the gap grows past ~1s. This reduces the latency between listeners.
  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track || track.platform !== 'youtube') return;

    const id = setInterval(() => {
      const state = platformStateRef.current;
      if (!state || !state.playing) return;
      const expected = computePlatformPosition(state);
      const actual = youtube.getPosition();
      if (typeof actual !== 'number' || actual <= 0) return;
      if (Math.abs(expected - actual) > 1.0) {
        youtube.seek(expected);
      }
    }, 3000);

    return () => clearInterval(id);
  }, [queue, currentTrackIndex, youtube]);

  // Ask the server for the current playback state on mount, so a device that
  // joins mid-song (2nd, 3rd, ... listener) starts playing in sync instead of
  // sitting silent until the next host action.
  useEffect(() => {
    if (!socket || !roomState?.id) return;
    socket.emit('playback:request-sync', { roomId: roomState.id });
  }, [socket, roomState?.id]);

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

    // Start the currently-active track INSIDE this user gesture so mobile
    // browsers allow it to play with sound. Then request a fresh sync so the
    // position is corrected precisely.
    const ps = platformStateRef.current || roomState?.playbackState;
    const track = queue[currentTrackIndex];
    if (track?.platform === 'youtube' && ps?.playing) {
      youtube.playTrack(track.uri, computePlatformPosition(ps));
    } else if (track?.url && track.platform !== 'spotify' && ps?.playing) {
      // Shared audio (Audius / uploads): start it within this gesture too so
      // mobile listeners actually hear it. Position gets corrected by the sync.
      try {
        const a = audioRef.current;
        if (a) {
          if (!a.src) loadTrack(track.url);
          a.play().catch(() => {});
        }
      } catch (_) { /* ignore */ }
    }
    if (socket && roomState?.id) {
      socket.emit('playback:request-sync', { roomId: roomState.id });
    }
  };

  // Explicitly activate the Spotify SDK audio element on this device.
  // Needed for listeners who never press Play themselves.
  // NOTE: we do NOT transfer playback here — on a shared Spotify account that
  // would steal the stream from the other device and cause playback to bounce.
  const handleActivateSpotify = () => {
    spotify.activate();
    setSpotifyActivated(true);
  };

  // Listener tap to start YouTube playback when the browser blocked autoplay.
  const handleYouTubeTap = () => {
    const track = queue[currentTrackIndex];
    if (!track || track.platform !== 'youtube') return;
    // Runs inside a user gesture, so the browser allows playback with sound.
    youtube.playTrack(track.uri, computePlatformPosition(platformStateRef.current));
  };

  // --- Media Session: lock-screen / background controls (mobile) ---
  // Shows play/pause/next/prev on the lock screen & notification shade, and
  // helps keep the shared audio (Audius / uploads) playing while the app is
  // backgrounded or the phone is locked.
  const mediaControlsRef = useRef({});
  mediaControlsRef.current = { handlePlay, handlePause, handleNext, handlePrev };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const track = queue[currentTrackIndex];
    if (track && 'MediaMetadata' in window) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: track.name || 'Unknown',
          artist: track.artist || track.addedBy || 'SyncStream',
          album: 'SyncStream',
          artwork: track.albumArt
            ? [
                { src: track.albumArt, sizes: '96x96', type: 'image/jpeg' },
                { src: track.albumArt, sizes: '256x256', type: 'image/jpeg' },
                { src: track.albumArt, sizes: '512x512', type: 'image/jpeg' }
              ]
            : []
        });
      } catch (_) { /* ignore */ }
    }
    const set = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) { /* unsupported action */ }
    };
    set('play', () => mediaControlsRef.current.handlePlay?.());
    set('pause', () => mediaControlsRef.current.handlePause?.());
    set('nexttrack', () => mediaControlsRef.current.handleNext?.());
    set('previoustrack', () => mediaControlsRef.current.handlePrev?.());
    return () => {
      ['play', 'pause', 'nexttrack', 'previoustrack'].forEach((a) => set(a, null));
    };
  }, [queue, currentTrackIndex]);

  // Reflect play/pause state to the OS lock screen
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  // Keep the lock-screen scrubber position in sync
  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const dur = isPlatformTrack ? platformProgress.duration : duration;
    const pos = isPlatformTrack ? platformProgress.time : currentTime;
    if (dur > 0 && pos >= 0 && pos <= dur) {
      try {
        navigator.mediaSession.setPositionState({ duration: dur, playbackRate: 1, position: pos });
      } catch (_) { /* ignore */ }
    }
  }, [currentTime, duration, platformProgress, isPlatformTrack]);

  // When the app returns from background / lock, re-request the current
  // position so playback catches back up in sync.
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === 'visible' && socket && roomState?.id) {
        socket.emit('playback:request-sync', { roomId: roomState.id });
      }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [socket, roomState?.id]);

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
      {/* YouTube tap-to-play prompt (browser blocked autoplay on this device).
          Shown whenever the room is playing a YouTube track but this device's
          player isn't actually playing — covers blocked autoplay, joining
          mid-song, and coming back from the background. */}
      {audioEnabled && isPlatformTrack && activeTrack?.platform === 'youtube' &&
        platformPlaying && (youtube.needsGesture || !youtube.isVideoPlaying) && (
        <div
          style={{
            position: 'fixed',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            background: '#ff0000',
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
          onClick={handleYouTubeTap}
        >
          ▶ Tap to play the music on this device
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

      {/* Sliding Members & Chat Panel */}
      <MembersPanel
        members={members}
        hostId={roomState.hostId}
        currentUserId={socket?.id}
        isHost={isHost}
        socket={socket}
        roomId={roomState.id}
      />

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

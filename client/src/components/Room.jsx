import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioSync } from '../hooks/useAudioSync';
import { useWebRTC } from '../hooks/useWebRTC';
import { useSpotify } from '../hooks/useSpotify';
import { useYouTube } from '../hooks/useYouTube';
import { useAudius } from '../hooks/useAudius';
import { useSaavn } from '../hooks/useSaavn';
import { useSoundCloud } from '../hooks/useSoundCloud';
import Player from './Player';
import Queue from './Queue';
import MembersPanel from './MembersPanel';
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
  const [songAddedToast, setSongAddedToast] = useState(null); // { name, addedBy }
  const songToastTimerRef = useRef(null);

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
    setSharedActive,
    stop,
    clockOffset
  } = useAudioSync(socket, handleTrackEnded);

  const spotify = useSpotify();
  const youtube = useYouTube(handleTrackEnded);
  const audius = useAudius();
  const saavn = useSaavn();
  const soundcloud = useSoundCloud();

  // Latest playback state for platform tracks, so a listener "tap to play"
  // can resume at the correct synced position.
  const platformStateRef = useRef(null);
  // Sync we still need to apply once the queue arrives (a device that joins
  // mid-song can receive the sync before its queue is populated).
  const pendingPlatformRef = useRef(null);
  // When THIS device just started a YouTube track from a tap gesture, we record
  // it here. The sync/pending/drift effects then skip re-issuing playTrack for a
  // short window so they don't interrupt the freshly-loading video (which would
  // leave it silently blocked while the clock advances).
  const recentGestureLoadRef = useRef({ videoId: null, at: 0 });
  const justStartedInGesture = (videoId) => {
    const g = recentGestureLoadRef.current;
    return g.videoId === videoId && (Date.now() - g.at < 2500);
  };
  // Key (track.id||url) of the source currently loaded into the shared <audio>
  // element, so we never reload/restart a track that's already loaded.
  const lastLoadedUrlRef = useRef(null);
  // Remembers the last user seek so polling holds the bar at the tapped spot
  // until the platform player actually reports it (YouTube/Spotify seek async).
  const recentSeekRef = useRef({ time: 0, at: 0 });
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
    sendOffer
  } = useWebRTC(socket, roomState?.id, isHost);

  // Handle adding a streaming platform track to the queue
  const handlePlatformTrackSelected = (track) => {
    // Was the queue empty before this add? If so, this is the "first song" —
    // start playing it immediately (inside the tap gesture, so mobile browsers
    // allow sound). Every later song just gets added to the queue.
    const isFirstSong = queue.length === 0;
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

    if (isFirstSong && canControl) {
      // Play this first track right away within the user gesture and tell the
      // server/other devices to start it in sync at index 0.
      spotify.activate();
      startTrackInGesture(track);
      socket.emit('playback:play', {
        roomId: roomState.id,
        trackIndex: 0,
        position: 0
      });
    }
  };

  // Listen for room updates
  useEffect(() => {
    if (!socket) return;

    const handleQueueUpdate = (newQueue) => setQueue(newQueue);
    const handleSongAdded = ({ name, addedBy }) => {
      setSongAddedToast({ name, addedBy });
      if (songToastTimerRef.current) clearTimeout(songToastTimerRef.current);
      songToastTimerRef.current = setTimeout(() => setSongAddedToast(null), 3500);
    };
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
    const handleControlChanged = ({ memberId, allowed }) => {
      setMembers(prev => prev.map(m => (m.id === memberId ? { ...m, canControl: allowed } : m)));
    };
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
          // Don't reload a source that's already loaded (e.g. the controller
          // just started it inside the tap gesture) — reloading restarts the
          // audio and snaps the progress bar back to 0.
          const key = nextTrack.id || nextTrack.url;
          if (lastLoadedUrlRef.current !== key) {
            lastLoadedUrlRef.current = key;
            loadTrack(nextTrack.url);
          }
        }
      }
    };

    socket.on('queue:updated', handleQueueUpdate);
    socket.on('queue:song-added', handleSongAdded);
    socket.on('room:member-joined', handleMemberJoined);
    socket.on('room:member-left', handleMemberLeft);
    socket.on('room:mode-changed', handleModeChanged);
    socket.on('room:control-changed', handleControlChanged);
    socket.on('room:host-changed', handleHostChanged);
    socket.on('room:kicked', handleKicked);
    socket.on('playback:sync', handlePlaybackSync);

    return () => {
      socket.off('queue:updated', handleQueueUpdate);
      socket.off('queue:song-added', handleSongAdded);
      socket.off('room:member-joined', handleMemberJoined);
      socket.off('room:member-left', handleMemberLeft);
      socket.off('room:mode-changed', handleModeChanged);
      socket.off('room:control-changed', handleControlChanged);
      socket.off('room:host-changed', handleHostChanged);
      socket.off('room:kicked', handleKicked);
      socket.off('playback:sync', handlePlaybackSync);
    };
  }, [socket, isHost, isStreaming, currentTrackIndex, queue, onLeave]);

  // Clear the song-added toast timer on unmount.
  useEffect(() => () => {
    if (songToastTimerRef.current) clearTimeout(songToastTimerRef.current);
  }, []);

  // Load initial track (handles both local and platform tracks)
  useEffect(() => {
    if (queue.length > 0 && queue[currentTrackIndex]) {
      const track = queue[currentTrackIndex];
      if (track.platform === 'spotify' || track.platform === 'apple') {
        // Platform tracks are played via their respective SDKs
        // The sync event will trigger playback on each client
      } else if (track.url) {
        // Only (re)load when the track actually changed. Otherwise adding a new
        // song to the queue re-runs this effect and reloads the shared <audio>,
        // which stops the song that's currently playing.
        const key = track.id || track.url;
        if (lastLoadedUrlRef.current !== key) {
          lastLoadedUrlRef.current = key;
          loadTrack(track.url);
        }
      }
    }
  }, [queue, currentTrackIndex, loadTrack]);

  // Enforce ONE active player at a time so two songs never overlap when
  // switching between a local (Audius/upload) track and a YouTube/Spotify one.
  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track) return;
    const isShared = track.platform !== 'youtube' && track.platform !== 'spotify';
    // Silence/allow the shared <audio> engine based on the active track type.
    setSharedActive(isShared);
    if (track.platform === 'youtube') {
      try { spotify.pause(); } catch (_) { /* ignore */ }
    } else if (track.platform === 'spotify') {
      try { youtube.pause(); } catch (_) { /* ignore */ }
    } else {
      // Local / Audius / upload: stop both platform players.
      try { youtube.pause(); } catch (_) { /* ignore */ }
      try { spotify.pause(); } catch (_) { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex, queue]);

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
          // Skip if this device just started the video from a tap gesture —
          // re-issuing playTrack now would interrupt the fresh load and leave it
          // blocked/silent.
          if (!justStartedInGesture(track.uri)) {
            youtube.playTrack(track.uri, computePlatformPosition(state));
          }
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
  //
  // IMPORTANT: apply the pending sync only ONCE (clear the ref afterwards) and
  // do NOT depend on the `youtube`/`spotify` objects — they are recreated on
  // every render, which would make this effect re-fire ~4x/sec and constantly
  // re-seek the player, causing playback to stop right after it starts.
  useEffect(() => {
    const state = pendingPlatformRef.current;
    if (!state || !state.playing) return;
    const track = queue[state.trackIndex];
    if (!track) return;
    pendingPlatformRef.current = null; // apply once; ongoing alignment is handled by the drift effect
    if (track.platform === 'youtube') {
      if (!justStartedInGesture(track.uri)) {
        youtube.playTrack(track.uri, computePlatformPosition(state));
      }
    } else if (track.platform === 'spotify' && spotify.isConnected) {
      spotify.playTrack(track.uri, computePlatformPosition(state) * 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentTrackIndex, spotify.isConnected]);

  // Poll the active platform player so the progress bar keeps moving for
  // YouTube/Spotify tracks (they don't use the shared <audio> element).
  const [platformProgress, setPlatformProgress] = useState({ time: 0, duration: 0 });

  // Whenever the active track changes, reset the progress bar to the start
  // immediately (Spotify-style). Polling then keeps it moving. This also runs
  // for listeners whose track changed via a sync event (not a local tap).
  useEffect(() => {
    const track = queue[currentTrackIndex];
    setPlatformProgress({ time: 0, duration: track?.duration ? track.duration / 1000 : 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex]);

  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track) return;

    let cancelled = false;
    let intervalId;

    if (track.platform === 'youtube') {
      intervalId = setInterval(() => {
        const d = youtube.getDuration();
        const local = youtube.getPosition();
        const state = platformStateRef.current;
        const sk = recentSeekRef.current;
        const seeking = Date.now() - sk.at < 1500;
        // Prefer THIS device's real player position so the timer/bar match what
        // the listener actually hears (no running ahead of a buffering player).
        // Fall back to the shared synced clock only when the local player isn't
        // reporting yet (blocked autoplay / still loading). Devices are kept
        // aligned by the separate drift-correction effect.
        let t;
        if (seeking && (typeof local !== 'number' || Math.abs(local - sk.time) > 1.5)) {
          // Just seeked here — hold the bar at the tapped position until the
          // player actually catches up, so it doesn't snap back behind.
          t = sk.time;
        } else if (typeof local === 'number' && local > 0) {
          t = local;
        } else if (justStartedInGesture(track.uri)) {
          // Just switched to this track in a tap — the shared clock still points
          // at the OLD song, so keep the bar at the start instead of snapping
          // to the previous song's elapsed time.
          t = 0;
        } else {
          t = state ? computePlatformPosition(state) : 0;
        }
        const dur = d || (track.duration ? track.duration / 1000 : 0);
        if (dur > 0) t = Math.min(t, dur);
        setPlatformProgress({ time: t || 0, duration: dur });
      }, 250);
    } else if (track.platform === 'spotify') {
      intervalId = setInterval(async () => {
        const p = await spotify.getPosition();
        if (cancelled) return;
        const state = platformStateRef.current;
        const sk = recentSeekRef.current;
        const seeking = Date.now() - sk.at < 1500;
        const localSec = (typeof p === 'number' && p > 0) ? p / 1000 : null;
        let t;
        if (seeking && (localSec === null || Math.abs(localSec - sk.time) > 1.5)) {
          t = sk.time;
        } else {
          t = localSec !== null ? localSec : (state ? computePlatformPosition(state) : 0);
        }
        const dur = track.duration ? track.duration / 1000 : 0;
        if (dur > 0) t = Math.min(t, dur);
        setPlatformProgress({ time: t || 0, duration: dur });
      }, 500);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentTrackIndex]);

  // Keep YouTube aligned across devices. YouTube players start slightly apart
  // and drift over time, so periodically re-seek to the synced position when
  // the gap grows past ~1s. This reduces the latency between listeners.
  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track || track.platform !== 'youtube') return;

    const id = setInterval(() => {
      const state = platformStateRef.current;
      if (!state || !state.playing) return;
      if (justStartedInGesture(track.uri)) return; // let a fresh gesture-load settle
      const expected = computePlatformPosition(state);
      const actual = youtube.getPosition();
      if (typeof actual !== 'number' || actual <= 0) return;
      if (Math.abs(expected - actual) > 1.0) {
        youtube.seek(expected);
      }
    }, 3000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentTrackIndex]);

  // Auto-start YouTube on this device without a manual tap. Once the listener
  // has enabled audio (the one-time overlay), we keep retrying automatically so
  // a track that got blocked, joined mid-song, or came back from the background
  // just resumes on its own — no "tap to play" pill needed.
  const ytStatusRef = useRef({ needsGesture: false, isVideoPlaying: false });
  ytStatusRef.current = { needsGesture: youtube.needsGesture, isVideoPlaying: youtube.isVideoPlaying };
  useEffect(() => {
    if (!audioEnabled) return;
    const track = queue[currentTrackIndex];
    if (!track || track.platform !== 'youtube') return;

    const id = setInterval(() => {
      const state = platformStateRef.current;
      if (!state || !state.playing) return;
      if (justStartedInGesture(track.uri)) return; // let a fresh gesture-load settle
      const { needsGesture, isVideoPlaying } = ytStatusRef.current;
      if (isVideoPlaying) return; // already playing — nothing to do
      // Don't force-restart a track that has essentially finished. When a song
      // ends, isVideoPlaying is also false, and without this guard the retry
      // would replay the ended track every 2s (a "plays 2s then restarts" loop)
      // instead of letting the queue advance to the next song.
      const dur = youtube.getDuration();
      const expected = computePlatformPosition(state);
      if (dur > 0 && expected >= dur - 1.5) return;
      // fromGesture=false: resume/seek without a full reload so it doesn't stutter.
      youtube.playTrack(track.uri, computePlatformPosition(state), false);
    }, 2000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentTrackIndex, audioEnabled]);

  // joins mid-song (2nd, 3rd, ... listener) starts playing in sync instead of
  // sitting silent until the next host action.
  useEffect(() => {
    if (!socket || !roomState?.id) return;
    socket.emit('playback:request-sync', { roomId: roomState.id });
  }, [socket, roomState?.id]);

  const myMember = members.find(m => m.id === socket?.id);
  const canControl = isHost || mode === 'collaborative' || !!myMember?.canControl;

  // YouTube/Spotify tracks report progress via their own players, not the shared <audio>
  const activeTrack = queue[currentTrackIndex] || null;
  const isPlatformTrack = activeTrack?.platform === 'youtube' || activeTrack?.platform === 'spotify';

  // When there is no active track (empty queue or the playing song was removed),
  // fully stop the shared audio and any platform player so the player bar does
  // not keep showing a moving progress bar with "No track loaded".
  useEffect(() => {
    if (!activeTrack) {
      try { stop(); } catch (_) { /* ignore */ }
      try { youtube.pause(); } catch (_) { /* ignore */ }
      try { spotify.pause(); } catch (_) { /* ignore */ }
      setPlatformPlaying(false);
      setPlatformProgress({ time: 0, duration: 0 });
      lastLoadedUrlRef.current = null;
    }
  }, [activeTrack, stop]);

  const handlePlay = () => {
    if (!canControl) return;
    // Unlock the Spotify SDK audio element on this device (must be in a gesture)
    spotify.activate();
    // For YouTube/Spotify tracks the shared <audio> currentTime is meaningless,
    // so resume from the real platform position instead of snapping to 0/stale.
    const position = isPlatformTrack
      ? (platformProgress.time || platformStateRef.current?.position || 0)
      : currentTime;
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: currentTrackIndex,
      position
    });
  };

  const handlePause = () => {
    if (!canControl) return;
    socket.emit('playback:pause', { roomId: roomState.id });
  };

  // Any player (YouTube iframe OR the shared <audio> element) must be kicked
  // off inside the tap gesture, or mobile browsers keep it silent/background
  // until the next real gesture (resume) — which then jumps ahead by the
  // elapsed synced time. Waiting for the socket round-trip lands the play()
  // outside the gesture, so we start it directly here. Fixes "changed the song
  // but it doesn't play" for YouTube AND Saavn/Audius/upload tracks.
  const startTrackInGesture = (track) => {
    if (!track) return;
    // Snap the progress bar back to the start instantly (like Spotify) instead
    // of leaving it at the previous song's position until polling catches up.
    setPlatformProgress({ time: 0, duration: track.duration ? track.duration / 1000 : 0 });
    const isSharedTrack = !!track.url && track.platform !== 'youtube' && track.platform !== 'spotify';
    // Stop every OTHER engine right away so the previous song (which may run on a
    // different engine — e.g. switching a YouTube song to a Saavn one) doesn't
    // keep playing/overlapping during the socket round-trip. Only the engine for
    // the new track is left running.
    try { if (!isSharedTrack) setSharedActive(false); } catch (_) { /* ignore */ }
    if (track.platform !== 'youtube') { try { youtube.pause(); } catch (_) { /* ignore */ } }
    if (track.platform !== 'spotify') { try { spotify.pause(); } catch (_) { /* ignore */ } }

    if (track.platform === 'youtube') {
      recentGestureLoadRef.current = { videoId: track.uri, at: Date.now() };
      youtube.playTrack(track.uri, 0, true);
    } else if (isSharedTrack) {
      // Shared <audio> tracks (Saavn / Audius / SoundCloud / upload):
      // load + play the new source inside this gesture. Set lastLoadedUrlRef so
      // the "load initial track" effect doesn't reload it a second time and cut
      // it off, and mark the shared engine active so it accepts sync.
      try {
        setSharedActive(true);
        const a = audioRef.current;
        if (a) {
          loadTrack(track.url);
          lastLoadedUrlRef.current = track.id || track.url;
          a.play().catch(() => {});
        }
      } catch (_) { /* ignore */ }
    }
  };

  const handleSeek = (time) => {
    if (!canControl) return;
    // Remember the seek so the poll holds the bar here until the player catches
    // up (platform players seek asynchronously and report the old position for
    // a moment, which would otherwise snap the bar back behind the tap).
    recentSeekRef.current = { time, at: Date.now() };
    // Optimistically reflect the new position locally so the seeker's progress
    // bar jumps instantly instead of waiting for the server round-trip.
    if (isPlatformTrack) {
      setPlatformProgress((p) => ({ ...p, time }));
    } else {
      seek(time);
    }
    socket.emit('playback:seek', { roomId: roomState.id, position: time });
  };

  const handleNext = () => {
    if (!canControl || queue.length === 0) return;
    spotify.activate();
    const nextIndex = (currentTrackIndex + 1) % queue.length;
    startTrackInGesture(queue[nextIndex]);
    socket.emit('playback:next', { roomId: roomState.id });
  };

  const handlePrev = () => {
    if (!canControl || queue.length === 0) return;
    spotify.activate();
    const prevIndex = currentTrackIndex === 0 ? queue.length - 1 : currentTrackIndex - 1;
    startTrackInGesture(queue[prevIndex]);
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: prevIndex,
      position: 0
    });
  };

  const handleTrackSelect = (index) => {
    if (!canControl) return;
    spotify.activate();
    startTrackInGesture(queue[index]);
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
      youtube.playTrack(track.uri, computePlatformPosition(ps), true);
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

  // Fallback: if the browser hard-blocks autoplay even after audio is enabled,
  // a single tap starts YouTube from within a user gesture (guaranteed allowed).
  const handleYouTubeTap = () => {
    const track = queue[currentTrackIndex];
    if (!track || track.platform !== 'youtube') return;
    youtube.playTrack(track.uri, computePlatformPosition(platformStateRef.current), true);
    if (socket && roomState?.id) {
      socket.emit('playback:request-sync', { roomId: roomState.id });
    }
  };

  // --- Media Session: lock-screen / background controls (mobile) ---
  // Shows play/pause/next/prev on the lock screen & notification shade, and
  // helps keep the shared audio (Audius / uploads) playing while the app is
  // backgrounded or the phone is locked.
  const mediaControlsRef = useRef({});
  mediaControlsRef.current = { handlePlay, handlePause, handleNext, handlePrev, handleSeek };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const track = queue[currentTrackIndex];
    if (track && 'MediaMetadata' in window) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: track.name || 'Unknown',
          artist: track.artist || track.addedBy || 'EchoFy',
          album: 'EchoFy',
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
    // Lock-screen scrubber drag + skip-forward/back buttons.
    set('seekto', (details) => {
      if (details && typeof details.seekTime === 'number') {
        mediaControlsRef.current.handleSeek?.(details.seekTime);
      }
    });
    set('seekbackward', (details) => {
      const step = (details && details.seekOffset) || 10;
      const now = navigator.mediaSession.__pos || 0;
      mediaControlsRef.current.handleSeek?.(Math.max(0, now - step));
    });
    set('seekforward', (details) => {
      const step = (details && details.seekOffset) || 10;
      const now = navigator.mediaSession.__pos || 0;
      const dur = navigator.mediaSession.__dur || 0;
      mediaControlsRef.current.handleSeek?.(dur ? Math.min(dur, now + step) : now + step);
    });
    return () => {
      ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekbackward', 'seekforward'].forEach((a) => set(a, null));
    };
  }, [queue, currentTrackIndex]);

  // Reflect play/pause state to the OS lock screen (platform-aware so YouTube /
  // Spotify tracks show the correct state too).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const nowPlaying = !activeTrack ? false : (isPlatformTrack ? platformPlaying : isPlaying);
    navigator.mediaSession.playbackState = !activeTrack ? 'none' : (nowPlaying ? 'playing' : 'paused');
  }, [isPlaying, platformPlaying, isPlatformTrack, activeTrack]);

  // Keep the lock-screen scrubber position in sync
  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const dur = isPlatformTrack ? platformProgress.duration : duration;
    const pos = isPlatformTrack ? platformProgress.time : currentTime;
    // Stash latest position/duration so seekforward/backward handlers can read them.
    navigator.mediaSession.__pos = pos;
    navigator.mediaSession.__dur = dur;
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
      {/* Ambient background: the current song's cover art, blurred & dimmed */}
      {activeTrack?.albumArt && (
        <div
          key={activeTrack.albumArt}
          className="room-bg-art"
          style={{ backgroundImage: `url("${activeTrack.albumArt}")` }}
          aria-hidden="true"
        />
      )}
      {/* Floating music notes — gentle ambient particles drifting upward */}
      <div className="room-notes" aria-hidden="true">
        <span>♪</span><span>♫</span><span>♩</span><span>♬</span>
        <span>♪</span><span>♫</span><span>♩</span><span>♬</span>
      </div>
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
      {/* "Song added" pop-up — shown to everyone when someone adds to the queue */}
      {songAddedToast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            color: '#fff',
            borderRadius: 12,
            padding: '12px 20px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: '90vw',
            fontSize: 14
          }}
        >
          <span style={{ fontSize: 18 }}>🎵</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{songAddedToast.addedBy}</strong> added <strong>{songAddedToast.name}</strong>
          </span>
        </div>
      )}

      {/* Fallback tap-to-play: only when the browser HARD-BLOCKS YouTube autoplay
          on this device (needsGesture). Auto-play handles every other case, so
          this rarely appears — it's here so a blocked listener can still start. */}
      {audioEnabled && isPlatformTrack && activeTrack?.platform === 'youtube' &&
        platformPlaying && youtube.needsGesture && (
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
        <div className="room-header-left">
          <div className="brand brand-inline">
            <span className="brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#0a0a0a">
                <rect x="2" y="9" width="3" height="6" rx="1.5" />
                <rect x="7" y="5.5" width="3" height="13" rx="1.5" />
                <rect x="12" y="2" width="3" height="20" rx="1.5" />
                <rect x="17" y="7" width="3" height="10" rx="1.5" />
              </svg>
            </span>
            <span className="brand-name">EchoFy</span>
          </div>
          <span className="header-divider" aria-hidden="true" />
          <div className="room-title-group">
            <span className="room-title-label">Listening Room</span>
            <div className="room-title-row">
              <h2>{roomState.name}</h2>
              <span className="room-code" onClick={copyRoomCode} title="Click to copy">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
                </svg>
                {roomState.id}
              </span>
            </div>
          </div>
        </div>
        <div className="room-meta">
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
          saavn={saavn}
          soundcloud={soundcloud}
          roomId={roomState.id}
          userId={socket?.id}
          onTrackSelected={handlePlatformTrackSelected}
          canControl={canControl}
          queueEmpty={queue.length === 0}
        />

        {queue.length > 0 && (
          <>
            <h3 style={{ marginBottom: 16, fontSize: 16 }}>Queue</h3>
            <Queue
              queue={queue}
              currentIndex={currentTrackIndex}
              onSelect={handleTrackSelect}
              onRemove={handleRemoveTrack}
              canControl={canControl}
            />
          </>
        )}
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
        isPlaying={!activeTrack ? false : (isPlatformTrack ? platformPlaying : isPlaying)}
        currentTime={!activeTrack ? 0 : (isPlatformTrack ? platformProgress.time : currentTime)}
        duration={!activeTrack ? 0 : (isPlatformTrack ? platformProgress.duration : duration)}
        currentTrack={activeTrack}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onNext={handleNext}
        onPrev={handlePrev}
        onVolumeChange={setVolume}
        canControl={canControl}
      />
    </div>
  );
}

export default Room;

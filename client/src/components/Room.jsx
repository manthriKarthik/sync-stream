import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioSync } from '../hooks/useAudioSync';
import { isUnchangedSnapshot } from '../hooks/playbackSync';
import { useWebRTC } from '../hooks/useWebRTC';
import { useYouTube } from '../hooks/useYouTube';
import { useAudius } from '../hooks/useAudius';
import { useSaavn } from '../hooks/useSaavn';
import { useSoundCloud } from '../hooks/useSoundCloud';
import Player from './Player';
import Queue from './Queue';
import MembersPanel from './MembersPanel';
import PlatformConnect from './PlatformConnect';
import SoninLogo from './SoninLogo';
import { Headphones, LogOut, Volume2, VolumeX, ListMusic, Music2 } from 'lucide-react';

function Room({ socket, roomState, setRoomState, username, userId, onLeave, connected }) {
  const [queue, setQueue] = useState(roomState?.queue || []);
  const [members, setMembers] = useState(roomState?.members || []);
  const [mode, setMode] = useState(roomState?.mode || 'host');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(
    roomState?.playbackState?.trackIndex || 0
  );
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [songAddedToast, setSongAddedToast] = useState(null); // { name, addedBy }
  const [codeCopied, setCodeCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const volumeRef = useRef(1);
  // Personal (local-only) mute: silences ALL audio engines on THIS device while
  // the room keeps playing, so a listener can step away and rejoin in sync just
  // by un-muting. Does NOT affect anyone else's playback.
  const [personalMuted, setPersonalMuted] = useState(false);
  const copyTimerRef = useRef(null);
  const songToastTimerRef = useRef(null);

  // Identity is by persistent userId (survives reconnects); fall back to the
  // socket id for older state that doesn't carry hostUserId.
  const isHost = roomState?.hostUserId
    ? roomState.hostUserId === userId
    : roomState?.hostId === socket?.id;

  // When a track finishes, only the HOST advances the queue. If every listener
  // emitted "next", 3+ people would skip multiple songs at once. The server
  // wraps back to the first track when the queue ends.
  const handleTrackEnded = useCallback(() => {
    if (!isHost) return;
    if (!socket?.connected || !roomState?.id) return;
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
    resume,
    seek,
    setVolume,
    setSharedActive,
    stop,
    clockOffset
  } = useAudioSync(socket, handleTrackEnded);

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
  // When the active track just changed on THIS device (via a tap OR an automatic
  // auto-advance/sync), the new player needs a moment to load & buffer. During
  // that window the shared clock keeps ticking, so the drift-correction and
  // auto-start loops must NOT yank the freshly-loaded video forward to the
  // elapsed position — doing so skips the first few seconds of the song. This
  // covers auto-advanced tracks, which `justStartedInGesture` (gesture-only)
  // does not.
  const recentTrackChangeRef = useRef(0);
  const justChangedTrack = () => Date.now() - recentTrackChangeRef.current < 3500;
  // Key (track.id||url) of the source currently loaded into the shared <audio>
  // element, so we never reload/restart a track that's already loaded.
  const lastLoadedUrlRef = useRef(null);
  // Mirror of `audioEnabled` for use inside gesture callbacks (avoids a stale
  // closure right after setAudioEnabled).
  const audioEnabledRef = useRef(false);
  audioEnabledRef.current = audioEnabled;

  // Treat a playback-control tap as the audio-unlock gesture: enable the
  // auto-resume/auto-start retry loops on this device AND prime the YouTube
  // iframe player. Without this, a host who only ever taps Saavn/Audius tracks
  // leaves their YouTube player locked, so a later (auto-advanced) YouTube song
  // silently fails to play for them while other listeners hear it fine.
  const unlockPlaybackEngines = (currentPlatform) => {
    if (!audioEnabledRef.current) {
      // First playback gesture on this device. Prime the YouTube player (unless
      // we're about to start a YouTube track, which unlocks itself via
      // playTrack(fromGesture=true)) so a later auto-advanced YouTube song can
      // play without a manual tap.
      if (currentPlatform !== 'youtube') {
        try { youtube.unlock(); } catch (_) { /* ignore */ }
      }
      audioEnabledRef.current = true;
      setAudioEnabled(true);
    }
  };
  // Remembers the last user seek so polling holds the bar at the tapped spot
  // until the platform player actually reports it (YouTube seeks asynchronously).
  const recentSeekRef = useRef({ time: 0, at: 0 });
  // Reactive flag: is the room currently playing a platform (YouTube)
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
    if (!connected || !socket?.connected) return;
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

    const handleQueueUpdate = (newQueue) => {
      // Keep the currently-playing track selected even if items before it were
      // removed (removing an earlier/finished song shifts indexes down, which
      // would otherwise leave currentTrackIndex pointing past the end and
      // unload the player / disable the controls).
      const active = queue[currentTrackIndex];
      if (active) {
        const activeKey = active.id || active.url;
        const newIdx = newQueue.findIndex(t => (t.id || t.url) === activeKey);
        if (newIdx === -1) {
          // The active track itself was removed — clamp to a valid index.
          setCurrentTrackIndex(idx => Math.min(idx, Math.max(0, newQueue.length - 1)));
        } else if (newIdx !== currentTrackIndex) {
          setCurrentTrackIndex(newIdx);
        }
      } else if (currentTrackIndex > newQueue.length - 1) {
        setCurrentTrackIndex(Math.max(0, newQueue.length - 1));
      }
      setQueue(newQueue);
    };
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
    const handleHostChanged = ({ newHostId, newHostUserId }) => {
      setRoomState(prev => ({ ...prev, hostId: newHostId, hostUserId: newHostUserId ?? prev.hostUserId }));
    };
    // Full-state refresh (fires on join and on reconnect auto-rejoin) — keeps
    // the member list, mode, queue and host identity in sync after a break.
    const handleRoomState = (state) => {
      if (!state) return;
      setCurrentTrackIndex(state.playbackState?.trackIndex ?? 0);
      setMembers(state.members || []);
      setMode(state.mode || 'host');
      if (Array.isArray(state.queue)) setQueue(state.queue);
      setRoomState(state);
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
        // uploads). YouTube plays through its own SDK and must NOT
        // pollute the shared audio element or they interfere with each other.
        if (nextTrack.url && nextTrack.platform !== 'youtube') {
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
    socket.on('room:state', handleRoomState);
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
      socket.off('room:state', handleRoomState);
      socket.off('room:kicked', handleKicked);
      socket.off('playback:sync', handlePlaybackSync);
    };
  }, [socket, isHost, isStreaming, currentTrackIndex, queue, onLeave]);

  // Clear the song-added toast timer on unmount.
  useEffect(() => () => {
    if (songToastTimerRef.current) clearTimeout(songToastTimerRef.current);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  // Load initial track (handles both local and platform tracks)
  useEffect(() => {
    if (queue.length > 0 && queue[currentTrackIndex]) {
      const track = queue[currentTrackIndex];
      if (track.platform === 'apple' || track.platform === 'youtube') {
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
  // switching between a local (Audius/upload) track and a YouTube one.
  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track) return;
    const isShared = track.platform !== 'youtube';
    // Silence/allow the shared <audio> engine based on the active track type.
    setSharedActive(isShared);
    if (isShared) {
      try { youtube.pause(); } catch (_) { /* ignore */ }
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
      const unchanged = isUnchangedSnapshot(platformStateRef.current, state);
      platformStateRef.current = state;
      pendingPlatformRef.current = state;
      setPlatformPlaying(!!state.playing);

      const track = queue[state.trackIndex];
      if (!track) return; // queue not ready yet — applied by the effect below
      pendingPlatformRef.current = null;
      if (unchanged) return;

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
      }
    };

    socket.on('playback:sync', handlePlatformSync);
    return () => socket.off('playback:sync', handlePlatformSync);
  }, [socket, queue, youtube, clockOffset]);

  // Apply any pending platform playback once the queue/track becomes available.
  // Fixes a device (2nd/3rd listener) that joined mid-song and received the
  // sync before its queue had loaded — previously it stayed silent with a
  // frozen progress bar and no "tap to play" prompt.
  //
  // IMPORTANT: apply the pending sync only ONCE (clear the ref afterwards) and
  // do NOT depend on the `youtube` object — it is recreated on
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentTrackIndex]);

  // Poll the active platform player so the progress bar keeps moving for
  // YouTube tracks (they don't use the shared <audio> element).
  const [platformProgress, setPlatformProgress] = useState({ time: 0, duration: 0 });

  // Whenever the active track changes, reset the progress bar to the start
  // immediately. Polling then keeps it moving. This also runs
  // for listeners whose track changed via a sync event (not a local tap).
  useEffect(() => {
    const track = queue[currentTrackIndex];
    setPlatformProgress({ time: 0, duration: track?.duration ? track.duration / 1000 : 0 });
    // Mark that the active track just changed so the drift/auto-start loops give
    // the freshly-loaded player time to buffer before correcting its position
    // (otherwise an auto-advanced song gets seeked past its first few seconds).
    recentTrackChangeRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex]);

  useEffect(() => {
    const track = queue[currentTrackIndex];
    if (!track) return;

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
    }

    return () => {
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
      if (justChangedTrack()) return; // let an auto-advanced track buffer from its start
      if (document.hidden || !ytStatusRef.current.isVideoPlaying) return;
      const expected = computePlatformPosition(state);
      const actual = youtube.getPosition();
      if (typeof actual !== 'number' || actual <= 0) return;
      if (Math.abs(expected - actual) > 2.5) {
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
      if (justChangedTrack()) return; // let an auto-advanced track buffer from its start
      const { needsGesture, isVideoPlaying } = ytStatusRef.current;
      if (document.hidden) return;
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

  // Auto-resume shared-audio tracks (Saavn / Audius / uploads) the same way —
  // no "tap to play" pill. Once audio is enabled the <audio> element is unlocked,
  // so a blocked/joined-mid-song track can be resumed programmatically. We retry
  // every 2s while it should be playing but the element is still paused.
  useEffect(() => {
    if (!audioEnabled) return;
    const track = queue[currentTrackIndex];
    const isShared = track && !!track.url && track.platform !== 'youtube';
    if (!isShared) return;

    const id = setInterval(() => {
      const state = platformStateRef.current;
      if (!state || !state.playing) return;
      const a = audioRef.current;
      if (!a || !a.src) return;
      if (!a.paused) return; // already playing — nothing to do
      resume();
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

  const myMember = members.find(m => (userId ? m.userId === userId : m.id === socket?.id));
  const canControl = connected && (isHost || mode === 'collaborative' || !!myMember?.canControl);

  // YouTube tracks report progress via their own player, not the shared <audio>
  const activeTrack = queue[currentTrackIndex] || null;
  const isPlatformTrack = activeTrack?.platform === 'youtube';

  // When there is no active track (empty queue or the playing song was removed),
  // fully stop the shared audio and any platform player so the player bar does
  // not keep showing a moving progress bar with "No track loaded".
  useEffect(() => {
    if (!activeTrack) {
      try { stop(); } catch (_) { /* ignore */ }
      try { youtube.pause(); } catch (_) { /* ignore */ }
      setPlatformPlaying(false);
      setPlatformProgress({ time: 0, duration: 0 });
      lastLoadedUrlRef.current = null;
    }
  }, [activeTrack, stop]);

  const handlePlay = () => {
    if (!canControl) return;
    // Also unlock YouTube + enable the auto-resume loops so a YouTube track
    // resumes on this device even if it wasn't started by a direct tap.
    unlockPlaybackEngines(activeTrack?.platform);
    // For YouTube tracks the shared <audio> currentTime is meaningless,
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
    // This tap is a user gesture — unlock the audio engines so a later
    // auto-advanced track (esp. YouTube) plays on this device without a manual
    // tap, and so the auto-resume retry loops become active.
    unlockPlaybackEngines(track.platform);
    // Snap the progress bar back to the start instantly instead
    // of leaving it at the previous song's position until polling catches up.
    setPlatformProgress({ time: 0, duration: track.duration ? track.duration / 1000 : 0 });
    const isSharedTrack = !!track.url && track.platform !== 'youtube';
    // Stop every OTHER engine right away so the previous song (which may run on a
    // different engine — e.g. switching a YouTube song to a Saavn one) doesn't
    // keep playing/overlapping during the socket round-trip. Only the engine for
    // the new track is left running.
    try { if (!isSharedTrack) setSharedActive(false); } catch (_) { /* ignore */ }
    if (track.platform !== 'youtube') { try { youtube.pause(); } catch (_) { /* ignore */ } }

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
    const nextIndex = (currentTrackIndex + 1) % queue.length;
    startTrackInGesture(queue[nextIndex]);
    socket.emit('playback:next', { roomId: roomState.id });
  };

  const handlePrev = () => {
    if (!canControl || queue.length === 0) return;
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
    startTrackInGesture(queue[index]);
    socket.emit('playback:play', {
      roomId: roomState.id,
      trackIndex: index,
      position: 0
    });
  };

  const handleModeChange = (newMode) => {
    if (!isHost || !connected || !socket?.connected) return;
    socket.emit('room:set-mode', { roomId: roomState.id, mode: newMode });
  };

  const handleRemoveTrack = (trackId) => {
    if (!canControl) return;
    socket.emit('queue:remove', { roomId: roomState.id, trackId });
  };

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomState.id);
      setCodeCopied(true);
      setCopyError('');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCodeCopied(false), 1600);
    } catch {
      setCopyError(`Copy unavailable. Room code: ${roomState.id}`);
    }
  };

  const handleVolumeChange = value => {
    volumeRef.current = value;
    setVolume(value);
    youtube.setVolume(value);
  };

  // Personal mute toggle — silence/​restore audio on THIS device only. The room
  // keeps playing for everyone else, so un-muting drops the listener straight
  // back in sync. Works for every platform (shared <audio>, YouTube).
  const applyPersonalMute = (muted) => {
    try { const a = audioRef.current; if (a) a.muted = muted; } catch (_) { /* ignore */ }
    try { if (muted) youtube.mute(); else youtube.unmute(); } catch (_) { /* ignore */ }
  };
  const togglePersonalMute = () => {
    setPersonalMuted((prev) => {
      const next = !prev;
      applyPersonalMute(next);
      // Coming back: re-sync so a slightly-drifted device snaps to the room.
      if (!next && socket && roomState?.id) {
        socket.emit('playback:request-sync', { roomId: roomState.id });
      }
      return next;
    });
  };

  // Re-apply the personal mute whenever the active track changes (an
  // auto-advanced song loads a fresh source / player state that would otherwise
  // start audible again on this device).
  useEffect(() => {
    if (personalMuted) applyPersonalMute(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex, personalMuted]);

  // Enable audio on mobile - must run from a user gesture to satisfy autoplay policies
  const handleEnableAudio = () => {
    // NOTE: do NOT prime the shared <audio> with play().then(pause) here — that
    // pause fires asynchronously and would silence the track we start below,
    // which was why a joining listener heard nothing until the host toggled
    // play/pause. The window-level unlock handler already blesses the element.
    // Unlock the YouTube IFrame player (applies any pending synced track)
    youtube.unlock();
    setAudioEnabled(true);

    // Start the currently-active track INSIDE this user gesture so mobile
    // browsers allow it to play with sound. Then request a fresh sync so the
    // position is corrected precisely.
    const ps = platformStateRef.current || roomState?.playbackState;
    const track = queue[currentTrackIndex];
    if (track?.platform === 'youtube' && ps?.playing) {
      youtube.playTrack(track.uri, computePlatformPosition(ps), true);
    } else if (track?.url && ps?.playing) {
      // Shared audio (Saavn / Audius / uploads): start it within this gesture
      // so mobile listeners actually hear it. Seek to the synced position first
      // so we join exactly where the room is, then play.
      try {
        const a = audioRef.current;
        if (a) {
          if (!a.src) loadTrack(track.url);
          setSharedActive(true);
          const pos = computePlatformPosition(ps);
          if (Number.isFinite(pos) && Math.abs((a.currentTime || 0) - pos) > 0.75) {
            try { a.currentTime = pos; } catch (_) { /* ignore */ }
          }
          a.play().catch(() => {});
        }
      } catch (_) { /* ignore */ }
    }
    if (socket && roomState?.id) {
      socket.emit('playback:request-sync', { roomId: roomState.id });
    }
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
  // Kept for potential manual use; auto-resume normally makes taps unnecessary.
  void handleYouTubeTap;

  // Stop ALL audio on this device before leaving, so nothing keeps playing
  // after the user leaves the room (shared <audio> and YouTube).
  const handleLeave = () => {
    try { stop(); } catch (_) { /* ignore */ }
    try {
      const a = audioRef.current;
      if (a) { a.pause(); a.src = ''; }
    } catch (_) { /* ignore */ }
    try { youtube.stop(); } catch (_) { /* ignore */ }
    onLeave();
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
          artist: track.artist || track.addedBy || 'Sonin',
          album: 'Sonin',
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

  // Reflect play/pause state to the OS lock screen, including YouTube tracks.
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
    let refreshTimer;
    const resync = () => {
      clearTimeout(refreshTimer);
      if (document.visibilityState === 'visible' && socket?.connected && roomState?.id) {
        refreshTimer = setTimeout(() => {
          socket.emit('playback:request-sync', { roomId: roomState.id });
        }, 150);
      }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      clearTimeout(refreshTimer);
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
      {!connected && <div className="room-notice" role="status">Reconnecting to your room...</div>}
      {/* "Song added" pop-up — shown to everyone when someone adds to the queue */}
      {songAddedToast && (
        <div className="song-toast">
          <Music2 size={18} />
          <span role="status"><strong>{songAddedToast.name}</strong> added by {songAddedToast.addedBy}</span>
        </div>
      )}

      {/* Header */}
      <div className="room-header">
        <div className="room-header-left">
          <SoninLogo />
          <span className="header-divider" aria-hidden="true" />
          <div className="room-title-group">
            <span className="room-title-label">Listening Room</span>
            <div className="room-title-row">
              <h2>{roomState.name}</h2>
              <button
                className={`room-code ${codeCopied ? 'copied' : ''}`}
                onClick={copyRoomCode}
                title="Copy room code"
                aria-label="Copy room code"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
                </svg>
                {codeCopied ? 'Copied!' : roomState.id}
              </button>
            </div>
          </div>
        </div>
        <div className="room-meta">
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            🕐 Sync: {Math.round(clockOffset)}ms offset
          </span>
          <button
            className={`btn ${personalMuted ? 'btn-primary' : 'btn-secondary'}`}
            onClick={togglePersonalMute}
            title={personalMuted ? 'Unmute audio on this device' : 'Mute audio on this device (the room keeps playing)'}
          >
            {personalMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}{personalMuted ? 'Muted' : 'Listening'}
          </button>
          <button className="btn btn-secondary" onClick={handleLeave}>
            <LogOut size={16} />Leave
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="room-main">
        <div className="room-toolbar">
          <div><span className="eyebrow">THE LISTENING ROOM</span><h1>Your next good listen.</h1></div>
          {isHost && <div className="mode-toggle" role="group" aria-label="Playback permissions">
            <button className={mode === 'host' ? 'active' : ''} aria-pressed={mode === 'host'} disabled={!connected} onClick={() => handleModeChange('host')}>Host controls</button>
            <button className={mode === 'collaborative' ? 'active' : ''} aria-pressed={mode === 'collaborative'} disabled={!connected} onClick={() => handleModeChange('collaborative')}>Everyone</button>
          </div>}
        </div>
        {copyError && <p className="form-error" role="status">{copyError}</p>}
        {!audioEnabled && <div className="audio-enable-bar"><Headphones size={20} /><span>Audio on this device is off</span><button className="btn btn-primary" onClick={handleEnableAudio}>Enable audio</button></div>}
        <PlatformConnect
          connected={connected}
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

        {queue.length > 0 ? (
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
        ) : <div className="queue-empty"><ListMusic size={32} /><h2>The queue is all yours.</h2><span>No tracks yet</span></div>}
      </div>

      {/* Sliding Members & Chat Panel */}
      <MembersPanel
        connected={connected}
        members={members}
        hostId={roomState.hostId}
        hostUserId={roomState.hostUserId}
        currentUserId={userId}
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
        onVolumeChange={handleVolumeChange}
        canControl={canControl}
      />
    </div>
  );
}

export default Room;

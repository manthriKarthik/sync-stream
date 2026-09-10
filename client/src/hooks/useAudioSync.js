import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { isUnchangedSnapshot, measureClockOffset, driftPlaybackRate, SOFT_DRIFT_LIMIT } from './playbackSync';

/**
 * Audio synchronization engine - v2 (optimized for remote/cross-network sync).
 * 
 * Uses:
 * - Multi-sample NTP clock sync (averages multiple round-trips for accuracy)
 * - Adaptive coordination buffer based on measured RTT
 * - Continuous drift correction every 2 seconds
 * - Smooth seek (avoids audible jumps for small drifts)
 */
export function useAudioSync(socket, onEnded) {
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = new Audio();
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [clockOffset, setClockOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // True when the shared <audio> element is SUPPOSED to be playing but the
  // browser blocked play() (iOS autoplay policy). The Room shows a tap-to-play
  // pill for shared tracks (Saavn/Audius/upload) when this is set.
  const [needsGesture, setNeedsGesture] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTrackUrl, setCurrentTrackUrl] = useState(null);
  const [rtt, setRtt] = useState(0);
  const unlockedRef = useRef(false);
  const syncIntervalRef = useRef(null);
  const driftCheckRef = useRef(null);
  const animFrameRef = useRef(null);
  // Active hls.js instance, when the current track is an HLS (.m3u8) stream
  // (e.g. Gaana). Torn down and recreated on each load.
  const hlsRef = useRef(null);
  const playbackStateRef = useRef(null);
  const offsetSamplesRef = useRef([]);
  // Timestamp of the last hard seek, to rate-limit hard seeks (avoids the iOS
  // "cut cut" stutter from seeking every drift check).
  const lastHardSeekRef = useRef(0);
  // Timestamp of the last fresh track load. For a few seconds after a new song
  // loads (e.g. an auto-advanced Saavn/Audius track), the element starts at 0
  // and needs time to buffer while the synced clock keeps ticking. Correcting
  // during this window would hard-seek the song forward past its first few
  // seconds, so drift correction is suppressed until the new track settles.
  const recentLoadRef = useRef(0);
  // Latest clock offset, mirrored into a ref so gesture handlers (resume) can
  // compute the synced position without stale closures.
  const clockOffsetRef = useRef(0);
  clockOffsetRef.current = clockOffset;
  // Whether the CURRENTLY active track uses this shared <audio> element
  // (Audius / uploads). When a YouTube/Spotify track is active this is false,
  // so we ignore playback:sync and keep the shared element silent — otherwise
  // the previously-loaded local song would replay on top of the platform one.
  const activeIsSharedRef = useRef(true);

  // Unlock audio playback on first user interaction (bypass autoplay policy)
  useEffect(() => {
    const audio = audioRef.current;
    audio.volume = 1;
    // Reduce buffering for lower latency
    audio.preload = 'auto';
    // Required for iOS/Android to allow inline + background/lock-screen playback
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    // Some mobile browsers only keep media alive in the background if the
    // element is attached to the document.
    if (!audio.parentNode) {
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }

    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      const st = playbackStateRef.current;
      // If a shared track is supposed to be playing, start it right now inside
      // this gesture and LEAVE it playing. The old code always paused right
      // after priming, which silenced the song the listener just joined — that
      // was the reason a second "tap to play" was needed. Now the single join
      // gesture is enough and playback continues on its own.
      if (st && st.playing && audio.src && activeIsSharedRef.current) {
        audio.play().then(() => setNeedsGesture(false)).catch(() => {});
        return;
      }
      // Otherwise prime the element silently so later programmatic plays work.
      audio.play().then(() => audio.pause()).catch(() => { /* ignore */ });
    };

    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);

    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Clock synchronization - Enhanced NTP with multi-sample averaging
  useEffect(() => {
    if (!socket) return;

    const syncClock = () => {
      if (document.hidden || !socket.connected) return;
      const t0 = Date.now();
      socket.emit('clock:ping', t0);
    };

    const handlePong = ({ clientTime, serverTime }) => {
      const t3 = Date.now();
      const roundTrip = t3 - clientTime;
      const offset = measureClockOffset(clientTime, serverTime, t3);
      if (document.hidden || offset === null) return;

      setRtt(roundTrip);

      // Keep last 10 samples, use median (resistant to outliers/jitter)
      offsetSamplesRef.current.push(offset);
      if (offsetSamplesRef.current.length > 10) {
        offsetSamplesRef.current.shift();
      }

      const sorted = [...offsetSamplesRef.current].sort((a, b) => a - b);
      const medianOffset = sorted[Math.floor(sorted.length / 2)];

      setClockOffset(medianOffset);
    };

    socket.on('clock:pong', handlePong);

    // Burst 5 pings at start for fast initial sync, then every 3s
    const burstTimers = Array.from({ length: 5 }, (_, index) => setTimeout(syncClock, index * 200));
    syncIntervalRef.current = setInterval(syncClock, 3000);
    const handleVisibility = () => {
      audioRef.current.playbackRate = 1;
      if (!document.hidden) syncClock();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      socket.off('clock:pong', handlePong);
      burstTimers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [socket]);

  // Continuous drift correction - runs periodically while playing
  useEffect(() => {
    // iOS Safari stutters ("cut cut") when the playbackRate of a streamed audio
    // element is changed, and it rebuffers on frequent seeks — especially in the
    // background. So on iOS we NEVER nudge the rate and only hard-seek for very
    // large drift, rarely. A little inter-device drift is imperceptible in a
    // room; audio cutting out is not.
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const checkDrift = () => {
      const audio = audioRef.current;
      const state = playbackStateRef.current;
      if (!state || !state.playing || audio.paused || !audio.src) return;

      // Don't correct while the tab/app is hidden (screen locked / backgrounded).
      if (typeof document !== 'undefined' && document.hidden) return;

      // Skip if a previous correction hasn't settled yet (still seeking) or the
      // audio isn't buffered enough to play smoothly.
      if (audio.seeking || audio.readyState < 3) return;

      // A freshly-loaded track (auto-advance / new song) starts at 0 and needs
      // a moment to buffer while the clock keeps advancing. Don't seek it
      // forward during this window or it skips its first few seconds; once the
      // song has been playing from 0 the clock and playback re-converge on their
      // own.
      if (Date.now() - recentLoadRef.current < 3500) return;

      const syncedNow = Date.now() + clockOffset;
      const elapsed = Math.max(0, (syncedNow - (state.syncTime ?? state.startedAt ?? syncedNow)) / 1000);
      const expectedPosition = Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, state.position + elapsed);
      const actualPosition = audio.currentTime;
      const drift = expectedPosition - actualPosition;
      const absDrift = Math.abs(drift);

      if (isIOS) {
        // iOS: no rate changes. Only correct really large drift, and rarely.
        if (absDrift >= SOFT_DRIFT_LIMIT && Date.now() - lastHardSeekRef.current > 12000) {
          lastHardSeekRef.current = Date.now();
          audio.currentTime = expectedPosition;
        }
        return;
      }

      // Small/medium drift: nudge the playback rate to converge smoothly with
      // NO audible gap.
      if (absDrift < SOFT_DRIFT_LIMIT) {
        audio.playbackRate = driftPlaybackRate(drift);
      }
      // Large drift: hard seek — but at most once every 6s so a persistent
      // small clock error can't trigger a seek-every-2s stutter loop.
      else if (Date.now() - lastHardSeekRef.current > 6000) {
        lastHardSeekRef.current = Date.now();
        audio.playbackRate = 1;
        audio.currentTime = expectedPosition;
      }
    };

    driftCheckRef.current = setInterval(checkDrift, isIOS ? 4000 : 2000);
    return () => {
      if (driftCheckRef.current) clearInterval(driftCheckRef.current);
    };
  }, [clockOffset]);

  // Get synchronized time
  const getSyncedNow = useCallback(() => {
    return Date.now() + clockOffset;
  }, [clockOffset]);

  // Handle playback sync commands from server
  useEffect(() => {
    if (!socket) return;

    const handlePlaybackSync = (state) => {
      const audio = audioRef.current;
      // If the active track plays through a platform SDK (YouTube/Spotify),
      // keep the shared element silent so two songs never overlap.
      if (!activeIsSharedRef.current) {
        if (!audio.paused) audio.pause();
        return;
      }
      if (audio.error && audio.src) {
        audio.load();
        recentLoadRef.current = Date.now();
      }
      const unchanged = isUnchangedSnapshot(playbackStateRef.current, state);
      const preservePlayback = unchanged && !audio.paused;
      playbackStateRef.current = state;
      if (preservePlayback) return;

      if (state.playing) {
        const syncedNow = Date.now() + clockOffset;
        const elapsed = state.syncTime ? (syncedNow - state.syncTime) / 1000 : 0;
        const targetPosition = state.position + Math.max(0, elapsed);

        if (audio.src) {
          // Seek to correct position. Use a wider tolerance so tiny differences
          // don't trigger a seek (each seek rebuffers on iOS -> audible cut).
          const drift = Math.abs(audio.currentTime - targetPosition);
          if (drift > (unchanged ? SOFT_DRIFT_LIMIT : 0.75)) {
            audio.currentTime = targetPosition;
          }

          if (audio.paused) {
            audio.playbackRate = 1.0;
            audio.play().then(() => {
              setNeedsGesture(false);
            }).catch((err) => {
              // Blocked by the browser's autoplay policy (typically iOS). Flag
              // it so the Room can show a tap-to-play pill for this track.
              console.error('Playback blocked:', err);
              setNeedsGesture(true);
            });
          }
        }
        setIsPlaying(true);
      } else {
        audio.pause();
        audio.playbackRate = 1.0;
        audio.currentTime = state.position;
        setIsPlaying(false);
      }
    };

    socket.on('playback:sync', handlePlaybackSync);
    return () => socket.off('playback:sync', handlePlaybackSync);
  }, [socket, clockOffset]);

  // Time tracking animation
  useEffect(() => {
    const audio = audioRef.current;

    // Throttle progress-bar state updates. Calling setCurrentTime on every
    // animation frame (~60fps) re-renders the whole Room/Player tree 60x/sec,
    // which causes severe lag on mobile. The progress bar only needs a few
    // updates per second; drift/sync logic reads audio.currentTime directly,
    // so throttling the React state has no effect on sync accuracy.
    let lastUpdate = 0;
    const updateTime = () => {
      const now = performance.now();
      if (now - lastUpdate >= 250) {
        lastUpdate = now;
        setCurrentTime(audio.currentTime);
      }
      animFrameRef.current = requestAnimationFrame(updateTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      // Let the Room decide how to advance (host-only, with the correct roomId).
      // The server wraps back to the first track when the queue finishes.
      onEndedRef.current?.();
    };

    // Once the element is actually producing sound, clear any tap-to-play flag.
    const handlePlaying = () => setNeedsGesture(false);

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('playing', handlePlaying);
    animFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('playing', handlePlaying);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [socket]);

  const loadTrack = useCallback((url) => {
    const audio = audioRef.current;
    // Tear down any previous HLS instance before loading a new source.
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
    const isHls = /\.m3u8(\?|$)/i.test(url || '');
    const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl');
    if (isHls && !nativeHls && Hls.isSupported()) {
      // Chrome / Android: play HLS via hls.js attached to the shared <audio>.
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(audio);
    } else {
      // Native HLS (Safari/iOS) or a plain MP3/MP4 progressive stream.
      // Assign the new source and explicitly call load(). On Android Chrome,
      // when the shared <audio> element is reused after a previous load ended
      // in an error state (networkState=NO_SOURCE), just setting .src does NOT
      // reliably kick off a fresh fetch — the element stays stuck and play()
      // produces no sound while the sync clock keeps advancing the timer.
      // load() forces a clean resource-selection pass. It is safe here because
      // loadTrack runs at most once per track change (guarded by
      // lastLoadedUrlRef) and play() is always called AFTER this, so it never
      // interrupts a pending play().
      audio.src = url;
      audio.load();
    }
    setCurrentTrackUrl(url);
    setCurrentTime(0);
    recentLoadRef.current = Date.now();
  }, []);

  // Clean up the HLS instance when the hook unmounts.
  useEffect(() => () => {
    const audio = audioRef.current;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.remove();
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    audioRef.current.play().catch(console.error);
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current.pause();
    setIsPlaying(false);
  }, []);

  // Resume the shared element from a user gesture (tap-to-play fallback for
  // Saavn/Audius/upload tracks blocked by iOS autoplay). Aligns to the synced
  // position first so the listener joins in sync, then plays.
  const resume = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const state = playbackStateRef.current;
    if (state && state.playing && a.src) {
      const syncedNow = Date.now() + clockOffsetRef.current;
      const elapsed = state.syncTime ? (syncedNow - state.syncTime) / 1000 : 0;
      const target = state.position + Math.max(0, elapsed);
      if (Number.isFinite(target) && Math.abs(a.currentTime - target) > SOFT_DRIFT_LIMIT) {
        try { a.currentTime = target; } catch (_) { /* ignore */ }
      }
    }
    a.play().then(() => {
      setIsPlaying(true);
      setNeedsGesture(false);
    }).catch(() => { /* still blocked — pill stays */ });
  }, []);

  // Fully stop and unload the shared element (used when the queue empties or the
  // active track is removed) so the player bar doesn't keep showing a moving
  // progress bar for a source that's no longer in the queue.
  const stop = useCallback(() => {
    const a = audioRef.current;
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
    if (a) {
      try { a.pause(); } catch (_) { /* ignore */ }
      try { a.removeAttribute('src'); a.load(); } catch (_) { /* ignore */ }
    }
    lastHardSeekRef.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCurrentTrackUrl(null);
  }, []);

  const seek = useCallback((time) => {
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const setVolume = useCallback((vol) => {
    audioRef.current.volume = Math.max(0, Math.min(1, vol));
  }, []);

  // Tell the engine whether the active track uses this shared <audio> element.
  // When set to false (a YouTube/Spotify track is active) the shared element is
  // paused and playback:sync events are ignored until it's shared again.
  const setSharedActive = useCallback((isShared) => {
    activeIsSharedRef.current = !!isShared;
    if (!isShared) {
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
    }
  }, []);

  return {
    audioRef,
    isPlaying,
    needsGesture,
    currentTime,
    duration,
    clockOffset,
    loadTrack,
    play,
    pause,
    resume,
    seek,
    setVolume,
    setSharedActive,
    stop,
    getSyncedNow
  };
}

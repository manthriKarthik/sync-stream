import { useEffect, useRef, useState, useCallback } from 'react';

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
  const audioRef = useRef(new Audio());
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [clockOffset, setClockOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTrackUrl, setCurrentTrackUrl] = useState(null);
  const [rtt, setRtt] = useState(0);
  const unlockedRef = useRef(false);
  const syncIntervalRef = useRef(null);
  const driftCheckRef = useRef(null);
  const animFrameRef = useRef(null);
  const playbackStateRef = useRef(null);
  const offsetSamplesRef = useRef([]);
  // Timestamp of the last hard seek, to rate-limit hard seeks (avoids the iOS
  // "cut cut" stutter from seeking every drift check).
  const lastHardSeekRef = useRef(0);
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
      audio.play().then(() => {
        audio.pause();
        unlockedRef.current = true;
      }).catch(() => {
        unlockedRef.current = true;
      });
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
      const t0 = Date.now();
      socket.emit('clock:ping', t0);
    };

    const handlePong = ({ clientTime, serverTime }) => {
      const t3 = Date.now();
      const roundTrip = t3 - clientTime;
      const oneWay = roundTrip / 2;
      const offset = serverTime + oneWay - t3;

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
    for (let i = 0; i < 5; i++) {
      setTimeout(syncClock, i * 200);
    }
    syncIntervalRef.current = setInterval(syncClock, 3000);

    return () => {
      socket.off('clock:pong', handlePong);
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

      const syncedNow = Date.now() + clockOffset;
      const elapsed = (syncedNow - state.syncTime) / 1000;
      const expectedPosition = state.position + elapsed;
      const actualPosition = audio.currentTime;
      const drift = expectedPosition - actualPosition;
      const absDrift = Math.abs(drift);

      if (isIOS) {
        // iOS: no rate changes. Only correct really large drift, and rarely.
        if (absDrift >= 2.5 && Date.now() - lastHardSeekRef.current > 12000) {
          lastHardSeekRef.current = Date.now();
          audio.currentTime = expectedPosition;
        }
        return;
      }

      // Small/medium drift: nudge the playback rate to converge smoothly with
      // NO audible gap.
      if (absDrift > 0.08 && absDrift < 1.0) {
        audio.playbackRate = drift > 0 ? 1.03 : 0.97;
        setTimeout(() => { audio.playbackRate = 1.0; }, 1200);
      }
      // Large drift: hard seek — but at most once every 6s so a persistent
      // small clock error can't trigger a seek-every-2s stutter loop.
      else if (absDrift >= 1.0 && Date.now() - lastHardSeekRef.current > 6000) {
        lastHardSeekRef.current = Date.now();
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
      playbackStateRef.current = state;

      if (state.playing) {
        const syncedNow = Date.now() + clockOffset;
        const elapsed = state.syncTime ? (syncedNow - state.syncTime) / 1000 : 0;
        const targetPosition = state.position + Math.max(0, elapsed);

        if (audio.src) {
          // Seek to correct position. Use a wider tolerance so tiny differences
          // don't trigger a seek (each seek rebuffers on iOS -> audible cut).
          const drift = Math.abs(audio.currentTime - targetPosition);
          if (drift > 0.75) {
            audio.currentTime = targetPosition;
          }

          if (audio.paused) {
            audio.playbackRate = 1.0;
            audio.play().catch((err) => {
              console.error('Playback blocked:', err);
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

    const updateTime = () => {
      setCurrentTime(audio.currentTime);
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

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    animFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [socket]);

  const loadTrack = useCallback((url) => {
    const audio = audioRef.current;
    audio.src = url;
    audio.load();
    setCurrentTrackUrl(url);
    setCurrentTime(0);
  }, []);

  const play = useCallback(() => {
    audioRef.current.play().catch(console.error);
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current.pause();
    setIsPlaying(false);
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
    currentTime,
    duration,
    clockOffset,
    loadTrack,
    play,
    pause,
    seek,
    setVolume,
    setSharedActive,
    getSyncedNow
  };
}

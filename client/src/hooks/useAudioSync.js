import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

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
  // Two physical <audio> "decks". audioRef always points at the ACTIVE deck
  // (the one the sync engine drives). deckOtherRef is the spare. For a
  // crossfade we let the outgoing song keep playing on its current deck (it's
  // already buffered at the right position, so there's no gap) while the new
  // song plays on the spare deck; then we swap which one is "active".
  const audioRef = useRef(new Audio());
  const deckOtherRef = useRef(new Audio());
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
  // Active hls.js instance, when the current track is an HLS (.m3u8) stream
  // (e.g. Gaana). Torn down and recreated on each load.
  const hlsRef = useRef(null);
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

  // --- Crossfade (local, per-device) ---
  // The user's desired volume (0..1). Fades ramp toward this.
  const targetVolumeRef = useRef(1);
  // Crossfade duration in seconds; 0 = disabled (default -> zero behavior change).
  const crossfadeRef = useRef(0);
  // Interval ids for the incoming fade-in and outgoing fade-out ramps.
  const fadeInIntervalRef = useRef(null);
  const fadeOutIntervalRef = useRef(null);

  const clearFadeIn = () => {
    if (fadeInIntervalRef.current) {
      clearInterval(fadeInIntervalRef.current);
      fadeInIntervalRef.current = null;
    }
  };
  const clearFadeOut = () => {
    if (fadeOutIntervalRef.current) {
      clearInterval(fadeOutIntervalRef.current);
      fadeOutIntervalRef.current = null;
    }
  };

  // Unlock audio playback on first user interaction (bypass autoplay policy)
  useEffect(() => {
    // Prime BOTH decks so either can start playing without a fresh gesture
    // (needed for the crossfade deck-swap and for auto-advance on mobile).
    const decks = [audioRef.current, deckOtherRef.current];
    decks.forEach((audio) => {
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
    });

    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      decks.forEach((audio) => {
        audio.play().then(() => { audio.pause(); }).catch(() => {});
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
    // Bind listeners to BOTH decks; guards below ensure only the ACTIVE deck
    // (audioRef.current) drives React state and queue advancement.
    const decks = [audioRef.current, deckOtherRef.current];

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
        setCurrentTime(audioRef.current.currentTime);
      }
      animFrameRef.current = requestAnimationFrame(updateTime);
    };

    const handleLoadedMetadata = (e) => {
      if (e.target === audioRef.current) setDuration(e.target.duration);
    };

    const handleEnded = (e) => {
      // Only the ACTIVE deck ending advances the queue. During a crossfade the
      // outgoing deck may also fire 'ended' as it finishes, but it isn't active.
      if (e.target !== audioRef.current) return;
      setIsPlaying(false);
      // Let the Room decide how to advance (host-only, with the correct roomId).
      // The server wraps back to the first track when the queue finishes.
      onEndedRef.current?.();
    };

    decks.forEach((audio) => {
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);
    });
    animFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      decks.forEach((audio) => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
      });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [socket]);

  const loadTrack = useCallback((url) => {
    const cfSeconds = crossfadeRef.current;
    const active = audioRef.current;
    const isHls = /\.m3u8(\?|$)/i.test(url || '');
    const oldSrc = active.currentSrc || active.src;
    // A real crossfade needs: the feature on, a shared-<audio> track, neither
    // the old nor new track on HLS, and the current deck actually playing a
    // *different* source. Otherwise fall back to a plain load.
    const canCrossfade =
      cfSeconds > 0 &&
      activeIsSharedRef.current &&
      !isHls &&
      !hlsRef.current &&
      !active.paused &&
      !!oldSrc && oldSrc !== url;

    if (canCrossfade) {
      // --- DUAL-DECK CROSSFADE ---
      const outgoing = active;                 // keeps playing from its buffered position
      const incoming = deckOtherRef.current;   // spare deck receives the new track
      const durMs = cfSeconds * 1000;

      clearFadeIn();
      clearFadeOut();

      // Prepare + start the incoming deck at volume 0.
      try { incoming.pause(); } catch (_) { /* ignore */ }
      incoming.src = url;
      incoming.load();
      incoming.volume = 0;
      incoming.playbackRate = 1.0;

      // Make the incoming deck the ACTIVE one BEFORE playing so the sync engine
      // (drift correction / playback:sync) immediately drives the new track.
      audioRef.current = incoming;
      deckOtherRef.current = outgoing;

      incoming.play().catch(() => {});

      // Fade the incoming deck up to the user's target volume.
      const beginIn = performance.now();
      fadeInIntervalRef.current = setInterval(() => {
        const t = (performance.now() - beginIn) / durMs;
        const target = targetVolumeRef.current;
        if (t >= 1) {
          incoming.volume = target;
          clearFadeIn();
          return;
        }
        incoming.volume = Math.max(0, Math.min(1, target * t));
      }, 40);

      // Fade the outgoing deck down, then pause + unload it so it becomes the
      // clean spare for the next switch.
      const startOutVol = outgoing.volume;
      const beginOut = performance.now();
      fadeOutIntervalRef.current = setInterval(() => {
        const t = (performance.now() - beginOut) / durMs;
        if (t >= 1) {
          clearFadeOut();
          try { outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load(); } catch (_) { /* ignore */ }
          outgoing.volume = targetVolumeRef.current;
          return;
        }
        outgoing.volume = Math.max(0, startOutVol * (1 - t));
      }, 40);

      setCurrentTrackUrl(url);
      setCurrentTime(0);
      return;
    }

    // --- PLAIN LOAD (no crossfade) — original behavior on the active deck ---
    const audio = audioRef.current;
    clearFadeIn();
    // Tear down any previous HLS instance before loading a new source.
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
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
    audio.volume = targetVolumeRef.current;

    setCurrentTrackUrl(url);
    setCurrentTime(0);
  }, []);

  // Clean up the HLS instance when the hook unmounts.
  useEffect(() => () => {
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
    clearFadeIn();
    clearFadeOut();
  }, []);

  const play = useCallback(() => {
    audioRef.current.play().catch(console.error);
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current.pause();
    setIsPlaying(false);
  }, []);

  // Fully stop and unload the shared element (used when the queue empties or the
  // active track is removed) so the player bar doesn't keep showing a moving
  // progress bar for a source that's no longer in the queue.
  const stop = useCallback(() => {
    clearFadeIn();
    clearFadeOut();
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (_) { /* ignore */ }
      hlsRef.current = null;
    }
    [audioRef.current, deckOtherRef.current].forEach((a) => {
      if (!a) return;
      try { a.pause(); } catch (_) { /* ignore */ }
      try { a.removeAttribute('src'); a.load(); } catch (_) { /* ignore */ }
      a.volume = targetVolumeRef.current;
    });
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
    const v = Math.max(0, Math.min(1, vol));
    targetVolumeRef.current = v;
    // If a fade is mid-flight, let the ramp converge to the new target;
    // otherwise apply immediately to the active deck.
    if (!fadeInIntervalRef.current && !fadeOutIntervalRef.current) {
      audioRef.current.volume = v;
    }
  }, []);

  // Enable/disable crossfade (local, per-device). seconds = 0 disables it, so
  // the default is a complete no-op versus the original behavior.
  const setCrossfade = useCallback((seconds) => {
    crossfadeRef.current = Math.max(0, Number(seconds) || 0);
  }, []);

  // Tell the engine whether the active track uses this shared <audio> element.
  // When set to false (a YouTube/Spotify track is active) both shared decks are
  // paused and playback:sync events are ignored until it's shared again.
  const setSharedActive = useCallback((isShared) => {
    activeIsSharedRef.current = !!isShared;
    if (!isShared) {
      clearFadeIn();
      clearFadeOut();
      [audioRef.current, deckOtherRef.current].forEach((a) => {
        if (a && !a.paused) a.pause();
      });
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
    setCrossfade,
    stop,
    getSyncedNow
  };
}

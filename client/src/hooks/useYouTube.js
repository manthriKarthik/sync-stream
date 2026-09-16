import { useEffect, useRef, useState, useCallback } from 'react';
import { searchProvider } from './searchProvider';

/**
 * YouTube IFrame Player API integration.
 * Plays audio from YouTube videos (music videos, lyric videos, etc.)
 * Free, no subscription needed — works for everyone.
 */
export function useYouTube(onEnded) {
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [apiReady, setApiReady] = useState(false);
  const [apiAttempt, setApiAttempt] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isConnected] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [player, setPlayer] = useState(null);
  const [currentTrack] = useState(null);
  const [error, setError] = useState(null);
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const pendingPlayRef = useRef(null);
  const loadedVideoIdRef = useRef(null);
  const wantsPlaybackRef = useRef(false);
  const playbackCheckRef = useRef(null);
  const mutedRef = useRef(false);
  const volumeRef = useRef(1);

  const clearPlaybackCheck = useCallback(() => {
    clearTimeout(playbackCheckRef.current);
    playbackCheckRef.current = null;
  }, []);

  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setApiReady(true);
      return;
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    const script = document.getElementById('youtube-iframe-api') || document.createElement('script');
    const handleError = () => {
      clearTimeout(loadTimer);
      script.remove();
      setError('YouTube could not load. Check your connection and retry.');
    };
    const loadTimer = setTimeout(handleError, 15000);
    const handleReady = () => {
      clearTimeout(loadTimer);
      previousReady?.();
      setError(null);
      setApiReady(true);
    };

    window.onYouTubeIframeAPIReady = handleReady;
    script.addEventListener('error', handleError);
    if (!script.isConnected) {
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.body.appendChild(script);
    }
    return () => {
      clearTimeout(loadTimer);
      script.removeEventListener('error', handleError);
      if (window.onYouTubeIframeAPIReady === handleReady) {
        window.onYouTubeIframeAPIReady = previousReady;
      }
    };
  }, [apiAttempt]);

  useEffect(() => {
    if (!apiReady || !containerRef.current) return;
    let disposed = false;
    const mount = document.createElement('div');
    containerRef.current.appendChild(mount);

    const ytPlayer = new window.YT.Player(mount, {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 0,
        controls: 1,
        iv_load_policy: 3,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: (event) => {
          if (disposed) return;
          playerRef.current = event.target;
          setPlayer(event.target);
          setIsReady(true);
          setError(null);
          try {
            event.target.setVolume(volumeRef.current * 100);
            if (mutedRef.current) event.target.mute();
            const iframe = event.target.getIframe();
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.title = 'YouTube video player';
            Object.assign(iframe.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0' });
          } catch (_) { /* ignore */ }
        },
        onStateChange: (event) => {
          if (disposed) return;
          setIsVideoPlaying(event.data === 1);
          setIsBuffering(event.data === 3);
          if (event.data === 1) {
            clearPlaybackCheck();
            setNeedsGesture(false);
            setError(null);
          } else if (event.data === 0 && wantsPlaybackRef.current) {
            wantsPlaybackRef.current = false;
            clearPlaybackCheck();
            onEndedRef.current?.({ duration: event.target.getDuration() });
          }
        },
        onAutoplayBlocked: () => {
          if (disposed || !wantsPlaybackRef.current) return;
          clearPlaybackCheck();
          setNeedsGesture(true);
          setIsVideoPlaying(false);
          setIsBuffering(false);
        },
        onError: (event) => {
          if (disposed) return;
          const errors = {
            2: 'Invalid YouTube video ID.',
            5: 'YouTube could not play this video. Retry playback.',
            100: 'This YouTube video is unavailable or private.',
            101: 'This video does not allow playback outside YouTube. Choose another track.',
            150: 'This video does not allow playback outside YouTube. Choose another track.',
            153: 'YouTube could not verify this site. Check browser referrer/privacy settings.'
          };
          clearPlaybackCheck();
          loadedVideoIdRef.current = null;
          pendingPlayRef.current = null;
          setNeedsGesture(false);
          setIsVideoPlaying(false);
          setIsBuffering(false);
          setError(errors[event.data] || 'YouTube playback error');
        }
      }
    });

    return () => {
      disposed = true;
      clearPlaybackCheck();
      pendingPlayRef.current = null;
      loadedVideoIdRef.current = null;
      wantsPlaybackRef.current = false;
      playerRef.current = null;
      ytPlayer.destroy();
      mount.remove();
    };
  }, [apiReady, clearPlaybackCheck]);

  const playTrack = useCallback((videoId, positionSeconds = 0, fromGesture = false) => {
    if (containerRef.current) containerRef.current.hidden = false;
    clearPlaybackCheck();
    setError(null);
    setNeedsGesture(false);
    wantsPlaybackRef.current = true;
    if (fromGesture) setIsUnlocked(true);
    if (!playerRef.current) {
      pendingPlayRef.current = { videoId, positionSeconds, requestedAt: Date.now() };
      if (fromGesture && !window.YT?.Player && !document.getElementById('youtube-iframe-api')) {
        setApiAttempt(attempt => attempt + 1);
      }
      return;
    }
    pendingPlayRef.current = null;
    try {
      const currentPlayer = playerRef.current;
      if (mutedRef.current) currentPlayer.mute();
      else currentPlayer.unMute();
      const sameVideo = loadedVideoIdRef.current === videoId;
      if (sameVideo) {
        const position = currentPlayer.getCurrentTime() || 0;
        if (Number.isFinite(positionSeconds) && Math.abs(position - positionSeconds) > 1.5) {
          currentPlayer.seekTo(positionSeconds, true);
        }
      } else {
        setIsVideoPlaying(false);
        setIsBuffering(true);
        loadedVideoIdRef.current = videoId;
        currentPlayer.loadVideoById({ videoId, startSeconds: positionSeconds || 0 });
      }
      currentPlayer.playVideo();
      const checkPlayback = (allowBuffering) => {
        if (!wantsPlaybackRef.current || playerRef.current !== currentPlayer || loadedVideoIdRef.current !== videoId) return;
        const state = currentPlayer.getPlayerState();
        if (state === 1) return;
        if (state === 3 && allowBuffering) {
          playbackCheckRef.current = setTimeout(() => checkPlayback(false), 15000);
          return;
        }
        setIsVideoPlaying(false);
        setIsBuffering(false);
        if (state === 3) {
          loadedVideoIdRef.current = null;
          setError('YouTube is taking too long to load. Retry playback.');
        } else {
          setNeedsGesture(true);
        }
      };
      playbackCheckRef.current = setTimeout(() => checkPlayback(true), 1200);
    } catch (_) {
      loadedVideoIdRef.current = null;
      setIsBuffering(false);
      setError('YouTube could not start this video. Retry playback.');
    }
  }, [clearPlaybackCheck]);

  useEffect(() => {
    if (!player || !playerRef.current) return;
    const pending = pendingPlayRef.current;
    if (!pending) return;
    pendingPlayRef.current = null;
    const elapsed = Math.max(0, (Date.now() - pending.requestedAt) / 1000);
    playTrack(pending.videoId, pending.positionSeconds + elapsed);
  }, [player, playTrack]);

  const unlock = useCallback(() => {
    setIsUnlocked(true);
    const pending = pendingPlayRef.current;
    if (pending) {
      const elapsed = Math.max(0, (Date.now() - pending.requestedAt) / 1000);
      playTrack(pending.videoId, pending.positionSeconds + elapsed, true);
    } else if (wantsPlaybackRef.current && loadedVideoIdRef.current && playerRef.current) {
      playTrack(loadedVideoIdRef.current, playerRef.current.getCurrentTime() || 0, true);
    }
  }, [playTrack]);

  const pause = useCallback(() => {
    wantsPlaybackRef.current = false;
    pendingPlayRef.current = null;
    clearPlaybackCheck();
    setNeedsGesture(false);
    setIsBuffering(false);
    setIsVideoPlaying(false);
    playerRef.current?.pauseVideo();
  }, [clearPlaybackCheck]);

  const stop = useCallback(() => {
    pause();
    try { playerRef.current?.stopVideo(); } catch (_) { /* ignore */ }
    loadedVideoIdRef.current = null;
  }, [pause]);

  const resume = useCallback(() => {
    if (loadedVideoIdRef.current && playerRef.current) {
      playTrack(loadedVideoIdRef.current, playerRef.current.getCurrentTime() || 0);
    }
  }, [playTrack]);

  // Seek (seconds)
  const seek = useCallback((positionSeconds) => {
    if (playerRef.current) playerRef.current.seekTo(positionSeconds, true);
  }, []);

  // Set volume (0-1)
  const setVolume = useCallback((vol) => {
    volumeRef.current = vol;
    if (playerRef.current) playerRef.current.setVolume(vol * 100);
  }, []);

  // Personal mute / unmute (local only — does not affect the room). The flag is
  // remembered so a later playTrack()/auto-advance keeps the user muted.
  const mute = useCallback(() => {
    mutedRef.current = true;
    try { playerRef.current?.mute(); } catch (_) { /* ignore */ }
  }, []);
  const unmute = useCallback(() => {
    mutedRef.current = false;
    try { playerRef.current?.unMute(); } catch (_) { /* ignore */ }
  }, []);

  // Get current time (seconds)
  const getPosition = useCallback(() => {
    if (!playerRef.current) return 0;
    return playerRef.current.getCurrentTime() || 0;
  }, []);

  // Get duration
  const getDuration = useCallback(() => {
    if (!playerRef.current) return 0;
    return playerRef.current.getDuration() || 0;
  }, []);

  // Search YouTube (uses the public search via a simple fetch — no API key needed for basic search)
  const searchTracks = useCallback(async (query) => {
    if (!query) return [];

    try {
      // Use YouTube's internal search endpoint (no API key needed)
      // This works by fetching the search page and parsing results
      return await searchProvider('youtube', query);
    } catch (err) {
      console.error('YouTube search error:', err);
      throw err;
    }
  }, []);

  // Extract video ID from various YouTube URL formats
  const extractVideoId = useCallback((url) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }, []);

  return {
    isReady,
    isConnected,
    isUnlocked,
    needsGesture,
    isVideoPlaying,
    isBuffering,
    containerRef,
    currentTrack,
    error,
    playTrack,
    unlock,
    pause,
    stop,
    resume,
    seek,
    setVolume,
    mute,
    unmute,
    getPosition,
    getDuration,
    searchTracks,
    extractVideoId
  };
}

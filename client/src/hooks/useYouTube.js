import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * YouTube IFrame Player API integration.
 * Plays audio from YouTube videos (music videos, lyric videos, etc.)
 * Free, no subscription needed — works for everyone.
 */
export function useYouTube() {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(true); // Always connected (no login needed)
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [player, setPlayer] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [error, setError] = useState(null);
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  const unlockedRef = useRef(false);
  const pendingPlayRef = useRef(null); // { videoId, positionSeconds } queued until unlock

  // Load YouTube IFrame API
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setIsReady(true);
      return;
    }

    // Create a hidden container for the YouTube player
    if (!document.getElementById('yt-player-container')) {
      const div = document.createElement('div');
      div.id = 'yt-player-container';
      // Keep it on-screen but tiny & nearly invisible. Some mobile browsers
      // refuse to play audio from a player positioned fully off-screen.
      div.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden;';
      const playerDiv = document.createElement('div');
      playerDiv.id = 'yt-player';
      div.appendChild(playerDiv);
      document.body.appendChild(div);
    }

    if (!document.getElementById('youtube-iframe-api')) {
      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(script);
    }

    window.onYouTubeIframeAPIReady = () => {
      setIsReady(true);
    };
  }, []);

  // Initialize player when API is ready
  useEffect(() => {
    if (!isReady || playerRef.current) return;

    const ytPlayer = new window.YT.Player('yt-player', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        rel: 0,
        playsinline: 1 // Required for iOS - prevents fullscreen takeover & allows programmatic play
      },
      events: {
        onReady: () => {
          playerRef.current = ytPlayer;
          setPlayer(ytPlayer);
          // Ensure the iframe permits programmatic autoplay (needed so listeners
          // can hear tracks the host starts without clicking each time).
          try {
            const iframe = ytPlayer.getIframe && ytPlayer.getIframe();
            if (iframe) iframe.setAttribute('allow', 'autoplay; encrypted-media');
          } catch (_) { /* ignore */ }
        },
        onStateChange: (event) => {
          // YT.PlayerState: ENDED=0, PLAYING=1, PAUSED=2, BUFFERING=3, CUED=5
          if (event.data === 1 || event.data === 3) {
            // Actually playing/buffering -> no manual tap needed
            setNeedsGesture(false);
          }
        },
        onError: (event) => {
          const errors = {
            2: 'Invalid video ID',
            5: 'HTML5 player error',
            100: 'Video not found or private',
            101: 'Embedding not allowed',
            150: 'Embedding not allowed'
          };
          setError(errors[event.data] || 'YouTube playback error');
        }
      }
    });
  }, [isReady]);

  // Play a video by YouTube video ID
  const playTrack = useCallback((videoId, positionSeconds = 0) => {
    setError(null);
    // If the player instance isn't ready yet, remember what to play and apply
    // it as soon as the player initializes (see the effect below).
    if (!playerRef.current) {
      pendingPlayRef.current = { videoId, positionSeconds };
      return;
    }
    try {
      playerRef.current.loadVideoById({
        videoId,
        startSeconds: positionSeconds || 0
      });
      playerRef.current.playVideo();
      // Verify playback actually started. On listener devices the browser may
      // block autoplay (no recent user gesture) — if so, ask for a tap.
      setTimeout(() => {
        const p = playerRef.current;
        if (!p || typeof p.getPlayerState !== 'function') return;
        const st = p.getPlayerState();
        // 1 = playing, 3 = buffering
        if (st !== 1 && st !== 3) {
          setNeedsGesture(true);
        }
      }, 1200);
    } catch (err) {
      pendingPlayRef.current = { videoId, positionSeconds };
    }
  }, []);

  // Apply any queued track once the player instance becomes ready.
  useEffect(() => {
    if (!player || !playerRef.current) return;
    const pending = pendingPlayRef.current;
    if (!pending) return;
    pendingPlayRef.current = null;
    try {
      playerRef.current.loadVideoById({
        videoId: pending.videoId,
        startSeconds: pending.positionSeconds || 0
      });
      playerRef.current.playVideo();
    } catch (_) { /* ignore */ }
  }, [player]);

  // Unlock playback on a user gesture (required by mobile autoplay policies).
  // Must be called synchronously from within a click/touch handler.
  const unlock = useCallback(() => {
    unlockedRef.current = true;
    setIsUnlocked(true);
    const p = playerRef.current;
    if (!p) return;

    const pending = pendingPlayRef.current;
    if (pending) {
      // Apply the queued track inside this user gesture so mobile allows it.
      pendingPlayRef.current = null;
      p.loadVideoById({
        videoId: pending.videoId,
        startSeconds: pending.positionSeconds || 0
      });
      p.playVideo();
    } else {
      // No track yet: prime the player with a muted play/pause to satisfy the
      // gesture requirement so later programmatic plays are allowed.
      try {
        p.mute();
        p.playVideo();
        setTimeout(() => {
          try {
            p.pauseVideo();
            p.unMute();
          } catch (_) { /* ignore */ }
        }, 50);
      } catch (_) { /* ignore */ }
    }
  }, []);

  // Pause
  const pause = useCallback(() => {
    if (playerRef.current) playerRef.current.pauseVideo();
  }, []);

  // Resume
  const resume = useCallback(() => {
    if (playerRef.current) playerRef.current.playVideo();
  }, []);

  // Seek (seconds)
  const seek = useCallback((positionSeconds) => {
    if (playerRef.current) playerRef.current.seekTo(positionSeconds, true);
  }, []);

  // Set volume (0-1)
  const setVolume = useCallback((vol) => {
    if (playerRef.current) playerRef.current.setVolume(vol * 100);
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
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch (err) {
      console.error('YouTube search error:', err);
      return [];
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
    currentTrack,
    error,
    playTrack,
    unlock,
    pause,
    resume,
    seek,
    setVolume,
    getPosition,
    getDuration,
    searchTracks,
    extractVideoId
  };
}

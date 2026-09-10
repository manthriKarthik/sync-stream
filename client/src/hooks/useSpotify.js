import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Spotify Web Playback SDK integration.
 * Each user connects their own Spotify Premium account.
 * The server coordinates which track to play and when.
 */
export function useSpotify() {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [token, setToken] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const playerRef = useRef(null);

  // Initialize Spotify SDK
  useEffect(() => {
    window.onSpotifyWebPlaybackSDKReady = () => setIsReady(true);
    // Load the Spotify SDK script
    if (!document.getElementById('spotify-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      setIsReady(true);
    };

    // If SDK already loaded
    if (window.Spotify) {
      setIsReady(true);
    }
  }, []);

  // Connect player when we have a token and SDK is ready
  const connect = useCallback(async (accessToken) => {
    if (!accessToken) return;
    setError(null);
    setIsConnecting(true);
    setToken(accessToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    if (!isReady) {
      const timer = setTimeout(() => {
        setIsConnecting(false);
        setError('Spotify player could not load. Allow sdk.scdn.co in your browser or network settings, then reconnect.');
        setToken(null);
      }, 15000);
      return () => clearTimeout(timer);
    }
    let disposed = false;
    let ready = false;
    const fail = message => {
      if (disposed) return;
      setError(message);
      setIsConnecting(false);
      setIsConnected(false);
      setToken(null);
    };

    const spotifyPlayer = new window.Spotify.Player({
      name: 'Sonin',
      getOAuthToken: (cb) => cb(token),
      volume: 1.0
    });
    playerRef.current = spotifyPlayer;
    setPlayer(spotifyPlayer);
    const timer = setTimeout(() => fail('Spotify player connection timed out. Check browser protected-content permissions and the app owner\'s Spotify Development Mode user access, then reconnect.'), 20000);

    // Error handling
    spotifyPlayer.addListener('initialization_error', ({ message }) => {
      fail(`Spotify player could not initialize: ${message}. Enable protected-content playback in your browser.`);
    });
    spotifyPlayer.addListener('authentication_error', ({ message }) => {
      fail(`Spotify authorization failed: ${message}. Reconnect; if the app is in Development Mode, its owner must allow your Spotify account in the dashboard.`);
    });
    spotifyPlayer.addListener('account_error', ({ message }) => {
      fail(`Spotify account cannot play here: ${message}. Use your own active Premium account and ask the app owner to check Development Mode user access.`);
    });
    spotifyPlayer.addListener('playback_error', ({ message }) => {
      console.error('Spotify playback error:', message);
    });

    // Ready
    spotifyPlayer.addListener('ready', ({ device_id }) => {
      if (disposed) return;
      ready = true;
      clearTimeout(timer);
      setDeviceId(device_id);
      setIsConnected(true);
      setIsConnecting(false);
      setError(null);
    });

    spotifyPlayer.addListener('not_ready', ({ device_id }) => {
      setIsConnected(false);
      setIsConnecting(false);
      setError('Spotify device is unavailable. Check your connection and reconnect Spotify.');
    });

    // Track changes
    spotifyPlayer.addListener('player_state_changed', (state) => {
      if (!state) return;
      setCurrentTrack(state.track_window.current_track);
    });

    Promise.resolve(spotifyPlayer.connect()).then(connected => {
      if (!connected && !ready) fail('Spotify refused the player connection. Check account access and browser protected-content settings, then reconnect.');
    }).catch(() => fail('Spotify player could not connect. Check your connection and try again.'));
    return () => {
      disposed = true;
      clearTimeout(timer);
      spotifyPlayer.disconnect();
      if (playerRef.current === spotifyPlayer) playerRef.current = null;
      setPlayer(null);
      setDeviceId(null);
      setIsConnected(false);
    };
  }, [isReady, token]);

  // Disconnect
  const disconnect = useCallback(() => {
    setToken(null);
    setIsConnecting(false);
    setIsConnected(false);
    setError(null);
  }, []);

  // Activate the Spotify SDK audio element (must be called from a user gesture,
  // otherwise the browser blocks audio and this device stays silent).
  const activate = useCallback(async () => {
    if (player && typeof player.activateElement === 'function') {
      try {
        await player.activateElement();
      } catch (err) {
        console.warn('Spotify activateElement failed:', err);
      }
    }
  }, [player]);

  // Transfer playback to this Sonin device so audio comes out here.
  const transferPlayback = useCallback(async () => {
    if (!token || !deviceId) return;
    try {
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_ids: [deviceId], play: false })
      });
    } catch (err) {
      console.warn('Spotify transfer failed:', err);
    }
  }, [token, deviceId]);

  // Play a specific track by Spotify URI (e.g., "spotify:track:4iV5W9uYEdYUVa79Axb7Rh")
  const playTrack = useCallback(async (spotifyUri, positionMs = 0) => {
    if (!token || !deviceId) return;

    // Make sure this device is the active one before playing
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uris: [spotifyUri],
        position_ms: Math.floor(positionMs)
      })
    });
  }, [token, deviceId]);

  // Pause
  const refreshPlayback = useCallback(async (spotifyUri, positionMs) => {
    if (!player) return;
    try {
      const state = await player.getCurrentState();
      if (state?.track_window?.current_track?.uri === spotifyUri) {
        if (state.paused) {
          await player.seek(Math.floor(positionMs));
          await player.resume();
        }
      } else {
        await playTrack(spotifyUri, positionMs);
      }
    } catch {
      setError('Spotify could not resume playback. Try enabling audio again.');
    }
  }, [player, playTrack]);

  const pause = useCallback(async () => {
    if (player) await player.pause();
  }, [player]);

  // Resume
  const resume = useCallback(async () => {
    if (player) await player.resume();
  }, [player]);

  // Seek
  const seek = useCallback(async (positionMs) => {
    if (player) await player.seek(Math.floor(positionMs));
  }, [player]);

  // Set volume
  const setVolume = useCallback(async (vol) => {
    if (player) await player.setVolume(vol);
  }, [player]);

  // Get current position
  const getPosition = useCallback(async () => {
    if (!player) return 0;
    const state = await player.getCurrentState();
    return state ? state.position : 0;
  }, [player]);

  // Search tracks
  const searchTracks = useCallback(async (query) => {
    if (!token || !query) return [];

    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!res.ok) return [];
    const data = await res.json();
    return data.tracks.items.map(track => ({
      id: track.id,
      uri: track.uri,
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[1]?.url || track.album.images[0]?.url,
      duration: track.duration_ms,
      platform: 'spotify'
    }));
  }, [token]);

  return {
    isReady,
    isConnecting,
    isConnected,
    deviceId,
    currentTrack,
    error,
    connect,
    disconnect,
    activate,
    transferPlayback,
    playTrack,
    refreshPlayback,
    pause,
    resume,
    seek,
    setVolume,
    getPosition,
    searchTracks
  };
}

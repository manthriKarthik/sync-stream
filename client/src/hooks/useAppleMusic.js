import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Apple Music (MusicKit JS) integration.
 * Each user authenticates with their own Apple Music subscription.
 */
export function useAppleMusic() {
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [musicKit, setMusicKit] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [error, setError] = useState(null);

  // Initialize MusicKit
  const initialize = useCallback(async (developerToken) => {
    try {
      // Load MusicKit JS if not already loaded
      if (!document.getElementById('musickit-sdk')) {
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.id = 'musickit-sdk';
          script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
          script.crossOrigin = 'anonymous';
          script.onload = resolve;
          document.body.appendChild(script);
        });
      }

      // Wait for MusicKit to be available
      await new Promise((resolve) => {
        if (window.MusicKit) return resolve();
        document.addEventListener('musickitloaded', resolve, { once: true });
      });

      const music = await window.MusicKit.configure({
        developerToken,
        app: {
          name: 'SyncStream',
          build: '1.0.0'
        }
      });

      setMusicKit(music);
      setIsReady(true);

      // Listen for playback changes
      music.addEventListener('playbackStateDidChange', () => {
        const nowPlaying = music.nowPlayingItem;
        if (nowPlaying) {
          setCurrentTrack({
            name: nowPlaying.title,
            artist: nowPlaying.artistName,
            album: nowPlaying.albumName,
            albumArt: nowPlaying.artworkURL?.replace('{w}', '200').replace('{h}', '200')
          });
        }
      });

    } catch (err) {
      setError(`Apple Music init failed: ${err.message}`);
    }
  }, []);

  // Authorize (user login)
  const authorize = useCallback(async () => {
    if (!musicKit) return;
    try {
      await musicKit.authorize();
      setIsConnected(true);
      setError(null);
    } catch (err) {
      setError('Apple Music authorization failed. Subscription required.');
    }
  }, [musicKit]);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (musicKit) {
      await musicKit.unauthorize();
      setIsConnected(false);
    }
  }, [musicKit]);

  // Play a track by Apple Music ID
  const playTrack = useCallback(async (trackId, positionSeconds = 0) => {
    if (!musicKit || !isConnected) return;
    try {
      await musicKit.setQueue({ song: trackId });
      if (positionSeconds > 0) {
        musicKit.seekToTime(positionSeconds);
      }
      await musicKit.play();
    } catch (err) {
      console.error('Apple Music play error:', err);
    }
  }, [musicKit, isConnected]);

  // Pause
  const pause = useCallback(async () => {
    if (musicKit) await musicKit.pause();
  }, [musicKit]);

  // Resume
  const resume = useCallback(async () => {
    if (musicKit) await musicKit.play();
  }, [musicKit]);

  // Seek
  const seek = useCallback(async (positionSeconds) => {
    if (musicKit) musicKit.seekToTime(positionSeconds);
  }, [musicKit]);

  // Set volume
  const setVolume = useCallback((vol) => {
    if (musicKit) musicKit.volume = vol;
  }, [musicKit]);

  // Get current position (seconds)
  const getPosition = useCallback(() => {
    if (!musicKit) return 0;
    return musicKit.currentPlaybackTime;
  }, [musicKit]);

  // Search tracks
  const searchTracks = useCallback(async (query) => {
    if (!musicKit || !query) return [];
    try {
      const results = await musicKit.api.music(`/v1/catalog/{{storefrontId}}/search`, {
        term: query,
        types: 'songs',
        limit: 10
      });

      const songs = results.data.results.songs?.data || [];
      return songs.map(song => ({
        id: song.id,
        uri: song.id,
        name: song.attributes.name,
        artist: song.attributes.artistName,
        album: song.attributes.albumName,
        albumArt: song.attributes.artwork?.url?.replace('{w}', '200').replace('{h}', '200'),
        duration: song.attributes.durationInMillis,
        platform: 'apple'
      }));
    } catch (err) {
      console.error('Apple Music search error:', err);
      return [];
    }
  }, [musicKit]);

  return {
    isReady,
    isConnected,
    currentTrack,
    error,
    initialize,
    authorize,
    disconnect,
    playTrack,
    pause,
    resume,
    seek,
    setVolume,
    getPosition,
    searchTracks
  };
}

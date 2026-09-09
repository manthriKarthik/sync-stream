import { useCallback, useRef } from 'react';

/**
 * Unified platform adapter that provides a single interface for
 * controlling playback regardless of the audio source:
 * - 'local' (uploaded files via HTML5 Audio)
 * - 'spotify' (Spotify Web Playback SDK)
 * - 'apple' (Apple MusicKit JS)
 */
export function usePlatformPlayer({ audioSync, spotify, appleMusic }) {
  const activePlatformRef = useRef('local');

  const getActivePlatform = useCallback(() => activePlatformRef.current, []);

  // Play a track on the appropriate platform
  const play = useCallback(async (track, positionMs = 0) => {
    const platform = track.platform || 'local';
    activePlatformRef.current = platform;

    switch (platform) {
      case 'spotify':
        if (spotify.isConnected) {
          await spotify.playTrack(track.uri, positionMs);
        }
        break;

      case 'apple':
        if (appleMusic.isConnected) {
          await appleMusic.playTrack(track.uri, positionMs / 1000);
        }
        break;

      case 'local':
      default:
        audioSync.loadTrack(track.url);
        audioSync.seek(positionMs / 1000);
        audioSync.play();
        break;
    }
  }, [spotify, appleMusic, audioSync]);

  // Pause on active platform
  const pause = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'spotify':
        await spotify.pause();
        break;
      case 'apple':
        await appleMusic.pause();
        break;
      case 'local':
      default:
        audioSync.pause();
        break;
    }
  }, [spotify, appleMusic, audioSync]);

  // Resume on active platform
  const resume = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'spotify':
        await spotify.resume();
        break;
      case 'apple':
        await appleMusic.resume();
        break;
      case 'local':
      default:
        audioSync.play();
        break;
    }
  }, [spotify, appleMusic, audioSync]);

  // Seek on active platform
  const seek = useCallback(async (positionMs) => {
    switch (activePlatformRef.current) {
      case 'spotify':
        await spotify.seek(positionMs);
        break;
      case 'apple':
        await appleMusic.seek(positionMs / 1000);
        break;
      case 'local':
      default:
        audioSync.seek(positionMs / 1000);
        break;
    }
  }, [spotify, appleMusic, audioSync]);

  // Set volume on active platform
  const setVolume = useCallback(async (vol) => {
    switch (activePlatformRef.current) {
      case 'spotify':
        await spotify.setVolume(vol);
        break;
      case 'apple':
        appleMusic.setVolume(vol);
        break;
      case 'local':
      default:
        audioSync.setVolume(vol);
        break;
    }
  }, [spotify, appleMusic, audioSync]);

  // Get current position (ms) from active platform
  const getPosition = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'spotify':
        return await spotify.getPosition();
      case 'apple':
        return appleMusic.getPosition() * 1000;
      case 'local':
      default:
        return audioSync.currentTime * 1000;
    }
  }, [spotify, appleMusic, audioSync]);

  return {
    play,
    pause,
    resume,
    seek,
    setVolume,
    getPosition,
    getActivePlatform
  };
}

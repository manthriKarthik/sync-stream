import { useCallback, useRef } from 'react';

/**
 * Unified platform adapter that provides a single interface for
 * controlling playback regardless of the audio source:
 * - 'local' (uploaded files via HTML5 Audio)
 * - 'apple' (Apple MusicKit JS)
 */
export function usePlatformPlayer({ audioSync, appleMusic }) {
  const activePlatformRef = useRef('local');

  const getActivePlatform = useCallback(() => activePlatformRef.current, []);

  // Play a track on the appropriate platform
  const play = useCallback(async (track, positionMs = 0) => {
    const platform = track.platform || 'local';
    activePlatformRef.current = platform;

    switch (platform) {
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
  }, [appleMusic, audioSync]);

  // Pause on active platform
  const pause = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'apple':
        await appleMusic.pause();
        break;
      case 'local':
      default:
        audioSync.pause();
        break;
    }
  }, [appleMusic, audioSync]);

  // Resume on active platform
  const resume = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'apple':
        await appleMusic.resume();
        break;
      case 'local':
      default:
        audioSync.play();
        break;
    }
  }, [appleMusic, audioSync]);

  // Seek on active platform
  const seek = useCallback(async (positionMs) => {
    switch (activePlatformRef.current) {
      case 'apple':
        await appleMusic.seek(positionMs / 1000);
        break;
      case 'local':
      default:
        audioSync.seek(positionMs / 1000);
        break;
    }
  }, [appleMusic, audioSync]);

  // Set volume on active platform
  const setVolume = useCallback(async (vol) => {
    switch (activePlatformRef.current) {
      case 'apple':
        appleMusic.setVolume(vol);
        break;
      case 'local':
      default:
        audioSync.setVolume(vol);
        break;
    }
  }, [appleMusic, audioSync]);

  // Get current position (ms) from active platform
  const getPosition = useCallback(async () => {
    switch (activePlatformRef.current) {
      case 'apple':
        return appleMusic.getPosition() * 1000;
      case 'local':
      default:
        return audioSync.currentTime * 1000;
    }
  }, [appleMusic, audioSync]);

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

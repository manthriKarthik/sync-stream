import { useCallback, useState } from 'react';
import { searchProvider } from './searchProvider';

/**
 * JioSaavn integration — free full-song streaming with a huge Bollywood /
 * Indian + international catalog (a great alternative to Gaana).
 *
 * No login required. Saavn returns direct stream URLs, so tracks play through
 * the app's shared <audio> element and get full drift-corrected sync AND
 * background / lock-screen playback (same reliable path as Audius). This hook
 * therefore only needs search; playback is handled by the shared audio engine.
 */
export function useSaavn() {
  const [error, setError] = useState(null);
  // Saavn needs no auth, so it's always "connected" and "ready".
  const isReady = true;
  const isConnected = true;

  const searchTracks = useCallback(async (query) => {
    if (!query) return [];
    setError(null);
    try {
      return await searchProvider('saavn', query);
    } catch (err) {
      console.error('Saavn search error:', err);
      setError('Saavn search failed');
      throw err;
    }
  }, []);

  return {
    isReady,
    isConnected,
    error,
    searchTracks
  };
}

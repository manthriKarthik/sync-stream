import { useCallback, useState } from 'react';
import { searchProvider } from './searchProvider';

/**
 * Audius integration — a free, open music streaming platform.
 *
 * No login required. Audius returns direct stream URLs, so tracks play through
 * the app's normal <audio> element and get full drift-corrected sync (same as
 * uploaded files). This hook therefore only needs search + trending; playback
 * is handled by the shared audio sync engine.
 */
export function useAudius() {
  const [error, setError] = useState(null);
  // Audius needs no auth, so it's always "connected" and "ready".
  const isReady = true;
  const isConnected = true;

  const searchTracks = useCallback(async (query) => {
    if (!query) return [];
    setError(null);
    try {
      return await searchProvider('audius', query);
    } catch (err) {
      console.error('Audius search error:', err);
      setError('Audius search failed');
      throw err;
    }
  }, []);

  const getTrending = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/audius/trending');
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch (err) {
      console.error('Audius trending error:', err);
      return [];
    }
  }, []);

  return {
    isReady,
    isConnected,
    error,
    searchTracks,
    getTrending
  };
}

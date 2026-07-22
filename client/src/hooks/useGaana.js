import { useCallback, useState } from 'react';

/**
 * Gaana integration — large Indian + some English catalog.
 *
 * No login required. The server decrypts Gaana's stream URLs to an HLS (.m3u8)
 * playlist, which the shared <audio> element plays via hls.js. Tracks therefore
 * get full drift-corrected sync + background playback (works for 3+ listeners).
 * Unofficial endpoint — may break over time. This hook only needs search.
 */
export function useGaana() {
  const [error, setError] = useState(null);
  const isReady = true;
  const isConnected = true;

  const searchTracks = useCallback(async (query) => {
    if (!query) return [];
    setError(null);
    try {
      const res = await fetch(`/api/gaana/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch (err) {
      console.error('Gaana search error:', err);
      setError('Gaana search failed');
      return [];
    }
  }, []);

  return {
    isReady,
    isConnected,
    error,
    searchTracks
  };
}

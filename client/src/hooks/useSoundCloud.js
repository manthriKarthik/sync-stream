import { useCallback, useState } from 'react';

/**
 * SoundCloud integration — free streaming with a huge English catalog
 * (official uploads, remixes, covers).
 *
 * No login required. The server resolves each track to a direct progressive
 * MP3 stream URL, so tracks play through the app's shared <audio> element and
 * get full drift-corrected sync AND background / lock-screen playback (the same
 * reliable path as Saavn/Audius) — so it works for 3+ listeners, unlike
 * YouTube. This hook therefore only needs search.
 */
export function useSoundCloud() {
  const [error, setError] = useState(null);
  const isReady = true;
  const isConnected = true;

  const searchTracks = useCallback(async (query) => {
    if (!query) return [];
    setError(null);
    try {
      const res = await fetch(`/api/soundcloud/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch (err) {
      console.error('SoundCloud search error:', err);
      setError('SoundCloud search failed');
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

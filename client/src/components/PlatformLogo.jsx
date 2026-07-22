// Shared brand logos for each source, used by the music-search tabs, the queue,
// and anywhere a track's origin should be shown at a glance.
function PlatformLogo({ platform, size = 18 }) {
  const s = size;

  switch (platform) {
    case 'youtube':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.1 31.1 0 0 0 0 12a31.1 31.1 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.1 31.1 0 0 0 24 12a31.1 31.1 0 0 0-.5-5.8z" />
          <path fill="#fff" d="M9.6 15.6V8.4l6.2 3.6z" />
        </svg>
      );
    case 'spotify':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#1DB954" />
          <path fill="#000" d="M17.6 10.9C14.6 9.1 9.6 8.9 6.7 9.8a.9.9 0 1 1-.5-1.7c3.3-1 8.8-.8 12.2 1.3a.9.9 0 0 1-.8 1.5zm-.1 2.7c-.3.4-.7.6-1.1.3-2.5-1.5-6.3-2-9.2-1.1a.75.75 0 0 1-.4-1.4c3.4-1 7.6-.5 10.5 1.3.3.2.4.6.2 1zm-1.2 2.5c-.2.3-.5.4-.8.2-2.2-1.3-4.9-1.6-8.1-.9a.63.63 0 1 1-.3-1.2c3.5-.8 6.5-.4 9 1.1.3.2.4.5.2.8z" />
        </svg>
      );
    case 'audius':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#CC0FE0" />
          <path fill="#fff" d="M12 5l6 11h-3.4L12 10.8 9.4 16H6z" />
        </svg>
      );
    case 'saavn':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="saavnGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2BC5B4" />
              <stop offset="1" stopColor="#1E9E8F" />
            </linearGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#saavnGrad)" />
          <path fill="#fff" d="M14.5 6v7.6a2.6 2.6 0 1 1-1.5-2.4V8.2l-4 1v5.2a2.6 2.6 0 1 1-1.5-2.4V8.5z" />
        </svg>
      );
    // Uploaded local files (no platform) and any unknown source.
    case 'upload':
    case 'local':
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#6366f1" />
          <path fill="#fff" d="M12 6l4 4h-2.5v4h-3v-4H8z" />
          <rect x="7.5" y="16" width="9" height="1.8" rx="0.9" fill="#fff" />
        </svg>
      );
  }
}

export default PlatformLogo;

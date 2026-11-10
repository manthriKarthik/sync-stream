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
    case 'soundcloud':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#FF5500" />
          <g fill="#fff">
            <rect x="5" y="11" width="1.4" height="6" rx="0.7" />
            <rect x="7.4" y="9.5" width="1.4" height="7.5" rx="0.7" />
            <rect x="9.8" y="10.5" width="1.4" height="6.5" rx="0.7" />
          </g>
          <path fill="#fff" d="M12.4 9.2c.4-1.9 2.1-3.2 4-3.2 2.3 0 4.1 1.8 4.1 4.1 0 .1 0 .3-.1.4.4.2.7.6.7 1.1 0 .7-.6 1.4-1.3 1.4h-7.4c-.3 0-.5-.2-.5-.5V9.7c0-.2.2-.4.5-.5z" />
        </svg>
      );
    case 'gaana':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#E72C30" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="1.8" fill="#fff" />
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

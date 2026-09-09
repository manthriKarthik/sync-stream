import PlatformLogo from './PlatformLogo';

function Queue({ queue, currentIndex, onSelect, onRemove, canControl }) {
  if (queue.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>🎶</p>
        <p>No tracks in queue yet.</p>
        <p style={{ fontSize: 12 }}>Upload audio files, connect Spotify/Apple Music, or start live capture.</p>
      </div>
    );
  }

  return (
    <ul className="queue-list">
      {queue.map((track, index) => (
        <li
          key={track.id}
          className={`queue-item ${index === currentIndex ? 'active' : ''}`}
          onClick={() => canControl && onSelect(index)}
        >
          <span className="track-num">
            {index === currentIndex ? (
              <span className="queue-eq" aria-label="Now playing">
                <i /><i /><i />
              </span>
            ) : (
              index + 1
            )}
          </span>
          {track.albumArt && (
            <img
              src={track.albumArt}
              alt=""
              className="queue-art"
              style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
            />
          )}
          <div className="track-info">
            <div className="name">
              <span className="queue-platform-logo"><PlatformLogo platform={track.platform} size={15} /></span>
              {track.name}
            </div>
            <div className="added-by">
              {track.artist ? `${track.artist} • ` : ''}Added by {track.addedBy}
            </div>
          </div>
          {canControl && (
            <button
              className="btn-icon"
              style={{ width: 28, height: 28, fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(track.id);
              }}
              title="Remove"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default Queue;

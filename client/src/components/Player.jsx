import { useState, useRef } from 'react';

function Player({ isPlaying, currentTime, duration, currentTrack, onPlay, onPause, onSeek, onNext, onPrev, onVolumeChange, canControl }) {
  const [volume, setVolume] = useState(1);
  const progressRef = useRef(null);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (e) => {
    if (!canControl || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    onSeek(percent * duration);
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    onVolumeChange(val);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-bar">
      {/* Left: track info */}
      <div className="player-track-info">
        {currentTrack?.albumArt ? (
          <img src={currentTrack.albumArt} alt="" className="player-art" />
        ) : (
          <div className="player-art player-art-placeholder">🎵</div>
        )}
        <div className="player-track-text">
          <div className="track-name">
            {currentTrack ? currentTrack.name : 'No track loaded'}
          </div>
          <div className="track-artist">
            {currentTrack
              ? (currentTrack.artist || `Added by ${currentTrack.addedBy}`)
              : 'Add music to the queue'}
          </div>
        </div>
      </div>

      {/* Center: controls + progress */}
      <div className="player-center">
        <div className="player-controls">
          <button
            className="btn-icon"
            onClick={onPrev}
            disabled={!canControl}
            title="Previous"
          >
            ⏮
          </button>

          <button
            className="play-btn"
            onClick={isPlaying ? onPause : onPlay}
            disabled={!canControl || !currentTrack}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <button
            className="btn-icon"
            onClick={onNext}
            disabled={!canControl}
            title="Next"
          >
            ⏭
          </button>
        </div>

        <div className="player-progress">
          <span className="time">{formatTime(currentTime)}</span>
          <div
            className={`progress-bar ${canControl ? '' : 'no-control'}`}
            ref={progressRef}
            onClick={handleProgressClick}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }}>
              <span className="progress-thumb" />
            </div>
          </div>
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: volume */}
      <div className="player-extra">
        <div className="player-volume">
          <span className="player-volume-icon">🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  );
}

export default Player;

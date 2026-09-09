import { useState, useRef, useEffect } from 'react';
import { Disc3, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';

function Player({ isPlaying, currentTime, duration, currentTrack, onPlay, onPause, onSeek, onNext, onPrev, onVolumeChange, canControl }) {
  const [volume, setVolume] = useState(1);
  const [overflows, setOverflows] = useState(false);
  const nameRef = useRef(null);

  // Only scroll the title when it's actually too long to fit
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const check = () => {
      const over = el.scrollWidth > el.clientWidth + 4;
      setOverflows(over);
      // Exact scroll distance so the end of the title just comes into view
      el.style.setProperty('--marquee-w', `${el.clientWidth}px`);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [currentTrack?.id, currentTrack?.name]);

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    onVolumeChange(val);
  };

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(currentTime) ? Math.max(0, Math.min(currentTime, safeDuration)) : 0;
  const progress = safeDuration > 0 ? (safeTime / safeDuration) * 100 : 0;

  return (
    <div className={`player-bar ${isPlaying && currentTrack ? 'is-live' : ''}`}>
      {/* Left: track info */}
      <div className="player-track-info">
        <div className={`player-art-wrap ${isPlaying && currentTrack ? 'is-playing' : ''}`}>
          {currentTrack?.albumArt ? (
            <img src={currentTrack.albumArt} alt="" className="player-art" />
          ) : (
            <div className="player-art player-art-placeholder"><Disc3 size={26} /></div>
          )}
          {isPlaying && currentTrack && (
            <span className="now-playing-eq" aria-hidden="true">
              <i /><i /><i /><i />
            </span>
          )}
        </div>
        <div className="player-track-text" key={currentTrack?.id || 'empty'}>
          <div
            ref={nameRef}
            className={`track-name ${isPlaying && currentTrack ? 'is-live' : ''} ${overflows ? 'marquee' : ''}`}
          >
            <span>{currentTrack ? currentTrack.name : 'No track loaded'}</span>
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
            disabled={!canControl || !currentTrack}
            title="Previous"
            aria-label="Previous"
          >
            <SkipBack size={20} />
          </button>

          <button
            className={`play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={isPlaying ? onPause : onPlay}
            disabled={!canControl || !currentTrack}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>

          <button
            className="btn-icon"
            onClick={onNext}
            disabled={!canControl || !currentTrack}
            title="Next"
            aria-label="Next"
          >
            <SkipForward size={20} />
          </button>
        </div>

        <div className="player-progress">
          <span className="time">{formatTime(currentTime)}</span>
          <input type="range" className="seek-slider" aria-label="Playback position" min="0" max={safeDuration || 1} step="0.1" value={safeTime} disabled={!canControl || !safeDuration || !currentTrack} onChange={event => onSeek(Number(event.target.value))} style={{ '--progress': `${progress}%` }} />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: volume */}
      <div className="player-extra">
        <div className="player-volume">
          <Volume2 size={18} />
          <input
            type="range"
            aria-label="Volume"
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

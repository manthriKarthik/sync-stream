import { useState, useRef, useEffect } from 'react';

function Player({ isPlaying, currentTime, duration, currentTrack, onPlay, onPause, onSeek, onNext, onPrev, onVolumeChange, canControl, audioElement }) {
  const [volume, setVolume] = useState(1);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('default');
  const [showDevices, setShowDevices] = useState(false);
  const progressRef = useRef(null);

  // Enumerate audio output devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Request permission to enumerate devices (some browsers need this)
        await navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => stream.getTracks().forEach(t => t.stop()))
          .catch(() => {}); // Permission denied is ok, we'll still get some devices

        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        setOutputDevices(outputs);
      } catch (err) {
        console.log('Device enumeration not supported:', err);
      }
    };

    loadDevices();

    // Re-enumerate when devices change (e.g. Bluetooth connects/disconnects)
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []);

  // Switch audio output device
  const handleDeviceChange = async (deviceId) => {
    setSelectedDevice(deviceId);
    setShowDevices(false);

    if (audioElement && typeof audioElement.setSinkId === 'function') {
      try {
        await audioElement.setSinkId(deviceId);
      } catch (err) {
        console.error('Failed to set output device:', err);
        alert('Could not switch output device. Your browser may not support this feature.');
      }
    } else {
      alert('Output device selection is not supported in this browser. Audio will play through your default device.');
    }
  };

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
      {/* Track info */}
      <div className="player-track-info">
        <div className="track-name">
          {currentTrack ? currentTrack.name : 'No track loaded'}
        </div>
        <div className="track-artist">
          {currentTrack ? `Added by ${currentTrack.addedBy}` : 'Add music to the queue'}
        </div>
      </div>

      {/* Controls */}
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

      {/* Progress */}
      <div className="player-progress">
        <span className="time">{formatTime(currentTime)}</span>
        <div
          className="progress-bar"
          ref={progressRef}
          onClick={handleProgressClick}
        >
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="time">{formatTime(duration)}</span>
      </div>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>🔊</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          style={{ width: 80, accentColor: 'var(--accent)' }}
        />
      </div>

      {/* Output Device Selector */}
      {outputDevices.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            className="btn-icon"
            onClick={() => setShowDevices(!showDevices)}
            title="Select audio output device"
            style={{ fontSize: 14 }}
          >
            🎧
          </button>
          {showDevices && (
            <div style={{
              position: 'absolute',
              bottom: '50px',
              right: 0,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 0',
              minWidth: '220px',
              zIndex: 100,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
            }}>
              <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Output Device
              </div>
              {outputDevices.map((device) => (
                <button
                  key={device.deviceId}
                  onClick={() => handleDeviceChange(device.deviceId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    background: selectedDevice === device.deviceId ? 'var(--accent-glow)' : 'transparent',
                    border: 'none',
                    color: selectedDevice === device.deviceId ? 'var(--accent)' : 'var(--text-primary)',
                    fontSize: '13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {selectedDevice === device.deviceId && '✓ '}
                  {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Player;

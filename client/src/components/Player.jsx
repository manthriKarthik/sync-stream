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

      {/* Right: volume + output device */}
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

        {outputDevices.length > 0 && (
          <div className="player-device">
            <button
              className="btn-icon device-btn"
              onClick={() => setShowDevices(!showDevices)}
              title="Select audio output device"
            >
              🎧
            </button>
            {showDevices && (
              <div className="device-menu">
                <div className="device-menu-title">Output Device</div>
                {outputDevices.map((device) => (
                  <button
                    key={device.deviceId}
                    onClick={() => handleDeviceChange(device.deviceId)}
                    className={`device-item ${selectedDevice === device.deviceId ? 'active' : ''}`}
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
    </div>
  );
}

export default Player;

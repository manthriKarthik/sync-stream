function LiveCapture({ isStreaming, onStartCapture, onStopCapture }) {
  return (
    <div className="live-capture">
      <h3>🎙️ Live Audio Capture</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Capture audio from your microphone or aux input and stream it live to all listeners.
      </p>

      {isStreaming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="live-indicator">
            <span className="dot"></span>
            LIVE
          </span>
          <button className="btn btn-danger" onClick={onStopCapture}>
            Stop Streaming
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={onStartCapture}>
          Start Live Capture
        </button>
      )}
    </div>
  );
}

export default LiveCapture;

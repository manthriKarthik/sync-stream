import { useRef, useState } from 'react';

function Upload({ roomId, userId }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = async (file) => {
    if (!file) return;

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('userId', userId || 'unknown');

    setUploading(true);
    try {
      const res = await fetch(`/api/upload/${roomId}`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  return (
    <div
      className="upload-area"
      onClick={() => fileInputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        borderColor: dragOver ? 'var(--accent)' : undefined,
        background: dragOver ? 'var(--accent-glow)' : undefined
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <div className="upload-icon">
        {uploading ? '⏳' : '📁'}
      </div>
      <p>
        {uploading
          ? 'Uploading...'
          : 'Drop audio file here or click to upload'}
      </p>
      <p style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)' }}>
        Supports MP3, WAV, OGG, FLAC, M4A, AAC (max 50MB)
      </p>
    </div>
  );
}

export default Upload;

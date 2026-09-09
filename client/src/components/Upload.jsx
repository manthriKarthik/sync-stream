import { useRef, useState } from 'react';
import { UploadCloud, LoaderCircle } from 'lucide-react';

function Upload({ roomId, userId }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const uploadingRef = useRef(false);

  const handleUpload = async (file) => {
    if (!file || uploadingRef.current) return;
    setError('');
    if (!/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)) {
      setError('Choose an MP3, WAV, OGG, FLAC, M4A or AAC file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('This file exceeds the 50 MB limit.');
      return;
    }

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('userId', userId || 'unknown');

    uploadingRef.current = true;
    setUploading(true);
    try {
      const res = await fetch(`/api/upload/${roomId}`, {
        method: 'POST',
        headers: { 'x-socket-id': userId },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      uploadingRef.current = false;
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
        accept=".mp3,.wav,.ogg,.flac,.m4a,.aac"
        aria-label="Audio file"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <div className="upload-icon">
        {uploading ? <LoaderCircle size={32} /> : <UploadCloud size={32} />}
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading...' : 'Choose audio file'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)' }}>
        Supports MP3, WAV, OGG, FLAC, M4A, AAC (max 50MB)
      </p>
    </div>
  );
}

export default Upload;

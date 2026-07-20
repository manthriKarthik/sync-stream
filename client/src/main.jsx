import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Load platform config (Spotify Client ID) so login works. Fetched once on startup.
fetch('/api/platforms/config')
  .then((res) => res.json())
  .then((cfg) => {
    if (cfg?.spotify?.clientId) {
      window.__SPOTIFY_CLIENT_ID = cfg.spotify.clientId;
    }
  })
  .catch(() => { /* platform config optional */ });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

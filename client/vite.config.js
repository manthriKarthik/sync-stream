import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { streaming: ['hls.js'] }
      }
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // Allow LAN access
    allowedHosts: true, // Allow tunnel hosts (cloudflare/localtunnel)
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true, // Proxy WebSocket connections
        changeOrigin: true
      }
    }
  }
});

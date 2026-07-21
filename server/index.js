import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { YouTube } from 'youtube-sr';
import { RoomManager } from './rooms.js';
import { ClockSyncHandler } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 50 * 1024 * 1024,
  // Optimize for cross-network connections
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['polling', 'websocket'],
  allowUpgrades: true
});

app.use(cors());
app.use(express.json());

// Serve audio files with proper range request support (required by iOS Safari)
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(__dirname, 'uploads', req.path);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400'
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400'
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

// File upload setup
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

// Room manager
const roomManager = new RoomManager();
const clockSync = new ClockSyncHandler();

// REST API
app.post('/api/upload/:roomId', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const roomId = req.params.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const track = {
    id: uuidv4(),
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    duration: null,
    addedBy: req.body.userId || 'unknown'
  };

  room.queue.push(track);
  io.to(roomId).emit('queue:updated', room.queue);

  res.json({ track });
});

app.get('/api/rooms', (req, res) => {
  res.json(roomManager.listRooms());
});

// Platform configuration endpoint (provides client IDs to frontend securely)
app.get('/api/platforms/config', (req, res) => {
  res.json({
    spotify: {
      clientId: process.env.SPOTIFY_CLIENT_ID || null,
      available: !!process.env.SPOTIFY_CLIENT_ID
    },
    apple: {
      developerToken: process.env.APPLE_MUSIC_DEVELOPER_TOKEN || null,
      available: !!process.env.APPLE_MUSIC_DEVELOPER_TOKEN
    }
  });
});

// Spotify token refresh (exchanges auth code for access token, keeping client secret server-side)
app.post('/api/platforms/spotify/token', async (req, res) => {
  const { code, redirectUri, codeVerifier } = req.body;
  const clientId = process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    return res.status(503).json({ error: 'Spotify not configured' });
  }

  try {
    // PKCE flow: use code_verifier instead of client_secret
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Spotify token error:', data);
      return res.status(400).json({ error: data.error_description || 'Token exchange failed' });
    }

    res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    });
  } catch (err) {
    console.error('Spotify token exchange error:', err.message);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

// YouTube search using youtube-sr
app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const videos = await YouTube.search(query + ' music', { limit: 10, type: 'video' });
    const results = videos.map(video => {
      const durationSec = Math.floor((video.duration || 0) / 1000);
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      return {
        id: video.id,
        uri: video.id,
        name: video.title || 'Unknown',
        artist: video.channel?.name || 'Unknown',
        album: '',
        albumArt: video.thumbnail?.url || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`,
        duration: video.duration || 0,
        durationText: `${mins}:${secs.toString().padStart(2, '0')}`,
        platform: 'youtube'
      };
    });
    res.json({ results });
  } catch (err) {
    console.error('YouTube search error:', err.message);
    res.json({ results: [] });
  }
});

// --- Audius (free, full-song streaming, no login) ---
let audiusHostCache = null;
let audiusHostCacheTime = 0;
const AUDIUS_APP = 'SyncStream';

async function getAudiusHost() {
  // Cache the discovered host for 10 minutes
  if (audiusHostCache && Date.now() - audiusHostCacheTime < 10 * 60 * 1000) {
    return audiusHostCache;
  }
  const res = await fetch('https://api.audius.co');
  const data = await res.json();
  const hosts = data?.data || [];
  if (!hosts.length) throw new Error('No Audius hosts available');
  audiusHostCache = hosts[Math.floor(Math.random() * hosts.length)];
  audiusHostCacheTime = Date.now();
  return audiusHostCache;
}

function mapAudiusTrack(track, host) {
  const durationSec = track.duration || 0;
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const artwork = track.artwork?.['480x480'] || track.artwork?.['150x150'] || '';
  return {
    id: track.id,
    uri: track.id,
    name: track.title || 'Unknown',
    artist: track.user?.name || 'Unknown',
    album: '',
    albumArt: artwork,
    // Direct stream URL — plays in the <audio> element like a local file,
    // so it gets full drift-corrected sync.
    url: `${host}/v1/tracks/${track.id}/stream?app_name=${AUDIUS_APP}`,
    duration: durationSec * 1000,
    durationText: `${mins}:${secs.toString().padStart(2, '0')}`,
    platform: 'audius'
  };
}

app.get('/api/audius/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const host = await getAudiusHost();
    const url = `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${AUDIUS_APP}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audius search failed: ${response.status}`);
    const data = await response.json();
    const tracks = (data?.data || []).filter(t => t.is_streamable !== false).slice(0, 12);
    const results = tracks.map(t => mapAudiusTrack(t, host));
    res.json({ results });
  } catch (err) {
    console.error('Audius search error:', err.message);
    // Retry once with a fresh host on next call
    audiusHostCache = null;
    res.json({ results: [] });
  }
});

// Trending Audius tracks (nice default content when search is empty)
app.get('/api/audius/trending', async (req, res) => {
  try {
    const host = await getAudiusHost();
    const response = await fetch(`${host}/v1/tracks/trending?app_name=${AUDIUS_APP}`);
    if (!response.ok) throw new Error(`Audius trending failed: ${response.status}`);
    const data = await response.json();
    const tracks = (data?.data || []).filter(t => t.is_streamable !== false).slice(0, 12);
    res.json({ results: tracks.map(t => mapAudiusTrack(t, host)) });
  } catch (err) {
    console.error('Audius trending error:', err.message);
    audiusHostCache = null;
    res.json({ results: [] });
  }
});


// Socket.IO handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Clock synchronization
  socket.on('clock:ping', (clientTime) => {
    socket.emit('clock:pong', {
      clientTime,
      serverTime: Date.now()
    });
  });

  // Room management
  socket.on('room:create', ({ username, roomName }) => {
    const room = roomManager.createRoom(roomName, socket.id, username);
    socket.join(room.id);
    socket.emit('room:created', room);
    socket.emit('room:state', roomManager.getRoomState(room.id));
  });

  socket.on('room:join', ({ roomId, username }) => {
    const normalizedId = roomId?.trim()?.toLowerCase();
    const room = roomManager.getRoom(normalizedId);
    if (!room) {
      socket.emit('error', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    roomManager.addMember(normalizedId, socket.id, username);
    socket.join(normalizedId);

    // Notify others
    io.to(normalizedId).emit('room:member-joined', { id: socket.id, username });
    socket.emit('room:state', roomManager.getRoomState(normalizedId));

    // If something is already playing, send the current sync state to the new
    // listener so they can catch up mid-song (with a recalculated position).
    if (room.playbackState && room.playbackState.playing) {
      const now = Date.now();
      const elapsed = (now - room.playbackState.startedAt) / 1000;
      const syncTime = now + 200; // coordination buffer
      socket.emit('playback:sync', {
        ...room.playbackState,
        position: (room.playbackState.position || 0) + Math.max(0, elapsed),
        startedAt: syncTime,
        syncTime
      });
    }
  });

  socket.on('room:leave', ({ roomId }) => {
    handleLeaveRoom(socket, roomId);
  });

  // Playback control (host or collaborative)
  socket.on('playback:play', ({ roomId, trackIndex, position }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    // Check if user is host or room is collaborative
    if (room.hostId !== socket.id && room.mode !== 'collaborative') {
      socket.emit('error', { message: 'Only the host can control playback' });
      return;
    }

    const syncTime = Date.now() + 200; // 200ms coordination buffer for remote users
    room.playbackState = {
      playing: true,
      trackIndex,
      position: position || 0,
      startedAt: syncTime,
      updatedAt: syncTime
    };

    io.to(roomId).emit('playback:sync', {
      ...room.playbackState,
      syncTime
    });
  });

  socket.on('playback:pause', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (room.hostId !== socket.id && room.mode !== 'collaborative') {
      socket.emit('error', { message: 'Only the host can control playback' });
      return;
    }

    const now = Date.now();
    const elapsed = (now - room.playbackState.startedAt) / 1000;
    room.playbackState = {
      ...room.playbackState,
      playing: false,
      position: room.playbackState.position + elapsed,
      updatedAt: now
    };

    io.to(roomId).emit('playback:sync', room.playbackState);
  });

  socket.on('playback:seek', ({ roomId, position }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (room.hostId !== socket.id && room.mode !== 'collaborative') return;

    const syncTime = Date.now() + 100;
    room.playbackState = {
      ...room.playbackState,
      position,
      startedAt: syncTime,
      updatedAt: syncTime
    };

    io.to(roomId).emit('playback:sync', {
      ...room.playbackState,
      syncTime
    });
  });

  socket.on('playback:next', ({ roomId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (room.hostId !== socket.id && room.mode !== 'collaborative') return;

    const nextIndex = (room.playbackState.trackIndex + 1) % room.queue.length;
    const syncTime = Date.now() + 100;
    room.playbackState = {
      playing: true,
      trackIndex: nextIndex,
      position: 0,
      startedAt: syncTime,
      updatedAt: syncTime
    };

    io.to(roomId).emit('playback:sync', { ...room.playbackState, syncTime });
  });

  // Queue management
  socket.on('queue:add-platform-track', ({ roomId, track }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    // Add streaming platform track to queue
    room.queue.push({
      id: track.id || uuidv4(),
      name: track.name,
      artist: track.artist,
      album: track.album,
      albumArt: track.albumArt,
      uri: track.uri,
      url: track.url || null, // Audius provides a direct stream URL; Spotify/YT don't
      duration: track.duration,
      platform: track.platform,
      addedBy: track.addedBy || 'unknown'
    });
    io.to(roomId).emit('queue:updated', room.queue);
  });

  socket.on('queue:reorder', ({ roomId, queue }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.queue = queue;
    io.to(roomId).emit('queue:updated', room.queue);
  });

  socket.on('queue:remove', ({ roomId, trackId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room.queue = room.queue.filter(t => t.id !== trackId);
    io.to(roomId).emit('queue:updated', room.queue);
  });

  // Mode switching
  socket.on('room:set-mode', ({ roomId, mode }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    room.mode = mode;
    io.to(roomId).emit('room:mode-changed', mode);
  });

  // Kick a member (host only)
  socket.on('room:kick', ({ roomId, memberId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (memberId === socket.id) return; // Can't kick yourself

    // Notify the kicked user
    io.to(memberId).emit('room:kicked');

    // Remove from room
    roomManager.removeMember(roomId, memberId);
    const kickedSocket = io.sockets.sockets.get(memberId);
    if (kickedSocket) {
      kickedSocket.leave(roomId);
    }

    // Notify others
    io.to(roomId).emit('room:member-left', { id: memberId });
  });

  // Live chat
  socket.on('chat:send', ({ roomId, message }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !room.members[socket.id]) return;

    const username = room.members[socket.id].username;
    io.to(roomId).emit('chat:message', {
      userId: socket.id,
      username,
      message,
      timestamp: Date.now()
    });
  });

  // WebRTC signaling for live audio streaming
  socket.on('webrtc:offer', ({ roomId, targetId, offer }) => {
    io.to(targetId).emit('webrtc:offer', {
      fromId: socket.id,
      offer
    });
  });

  socket.on('webrtc:answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc:answer', {
      fromId: socket.id,
      answer
    });
  });

  socket.on('webrtc:ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc:ice-candidate', {
      fromId: socket.id,
      candidate
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const rooms = roomManager.getRoomsForSocket(socket.id);
    rooms.forEach(roomId => handleLeaveRoom(socket, roomId));
  });
});

function handleLeaveRoom(socket, roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  roomManager.removeMember(roomId, socket.id);
  socket.leave(roomId);
  io.to(roomId).emit('room:member-left', { id: socket.id });

  // If host leaves, transfer host or close room
  if (room.hostId === socket.id) {
    const members = Object.keys(room.members);
    if (members.length > 0) {
      room.hostId = members[0];
      io.to(roomId).emit('room:host-changed', { newHostId: members[0] });
    } else {
      roomManager.deleteRoom(roomId);
    }
  }
}

const PORT = process.env.PORT || 3001;

// Serve the built client (production/shared mode) with SPA fallback.
// Run `npm run build` in the client folder to generate client/dist.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('Client not built yet. Run: cd client && npm run build');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Sync-Stream server running on http://localhost:${PORT}`);
});

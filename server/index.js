import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    roomManager.addMember(roomId, socket.id, username);
    socket.join(roomId);

    // Notify others
    io.to(roomId).emit('room:member-joined', { id: socket.id, username });
    socket.emit('room:state', roomManager.getRoomState(roomId));
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

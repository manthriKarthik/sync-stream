# 🎵 EchoFy - Listen Together

A real-time multi-listener audio streaming app where multiple people can listen to the same music through their own Bluetooth earbuds in perfect sync.

## Features

- **Synchronized Playback** - NTP-style clock sync ensures all listeners hear the same audio at the same moment
- **Host/DJ Mode** - One person controls the music, everyone listens
- **Collaborative Mode** - Anyone can control playback and add to the queue
- **File Upload** - Upload MP3, WAV, OGG, FLAC, M4A, AAC files
- **Live Audio Capture** - Stream microphone/aux input via WebRTC (peer-to-peer, lowest latency)
- **Room System** - Create rooms with short invite codes
- **Beautiful UI** - Dark theme, responsive design

## How Sync Works

1. **Clock Sync**: Each client measures its clock offset from the server using an NTP-like ping/pong algorithm
2. **Coordinated Start**: When play is pressed, the server broadcasts a future timestamp (100ms ahead) for all clients to begin playback simultaneously
3. **Drift Correction**: If a client drifts more than 150ms from the expected position, it auto-corrects
4. **Bluetooth Note**: Since all users have similar Bluetooth codec latency (~40-200ms), the perceived sync is maintained naturally

## Quick Start

### Prerequisites
- Node.js 18+ installed

### Install & Run

```bash
# Install all dependencies
npm run install:all

# Start both server and client in development mode
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001

### Usage

1. Open the app in your browser
2. Enter your name and create a room
3. Share the room code with friends
4. Friends open the app and join with the room code
5. Upload music or start live capture
6. Everyone connects their Bluetooth earbuds and listens together!

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | UI & dev server |
| Styling | CSS (custom) | Dark theme, responsive |
| Real-time | Socket.IO | Room management, sync signals |
| Audio Sync | Web Audio API | Precise playback control |
| Live Stream | WebRTC | Peer-to-peer audio (mic/aux) |
| Backend | Express + Node.js | API, file serving, signaling |
| Storage | File system (uploads/) | Audio file storage |

## Architecture

```
┌─────────────────────────────────────────────┐
│                   Client A (Host)           │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Upload  │  │  Player  │  │  WebRTC   │  │
│  │  Files  │  │  Engine  │  │  Sender   │  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │              │         │
└───────┼─────────────┼──────────────┼─────────┘
        │             │              │
   HTTP POST    Socket.IO        P2P Audio
        │             │              │
┌───────┼─────────────┼──────────────┼─────────┐
│       ▼             ▼              │         │
│  ┌─────────┐  ┌──────────┐        │         │
│  │  File   │  │  Room &  │        │  Server │
│  │ Storage │  │   Sync   │        │         │
│  └─────────┘  └──────────┘        │         │
│                     │              │         │
└─────────────────────┼──────────────┼─────────┘
                      │              │
                 Socket.IO       P2P Audio
                      │              │
┌─────────────────────┼──────────────┼─────────┐
│                     ▼              ▼         │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Clock   │  │  Player  │  │  WebRTC   │  │
│  │   Sync   │  │  Engine  │  │ Receiver  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│                Client B (Listener)           │
└─────────────────────────────────────────────┘
```

## Project Structure

```
sync-stream/
├── package.json          # Root workspace config
├── server/
│   ├── package.json
│   ├── index.js          # Express + Socket.IO server
│   ├── rooms.js          # Room management logic
│   ├── sync.js           # Clock sync utilities
│   └── uploads/          # Uploaded audio files (created at runtime)
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       ├── components/
│       │   ├── Landing.jsx    # Create/Join room screen
│       │   ├── Room.jsx       # Main room view
│       │   ├── Player.jsx     # Audio player controls
│       │   ├── Queue.jsx      # Track queue list
│       │   ├── Members.jsx    # Room members sidebar
│       │   ├── Upload.jsx     # File upload component
│       │   └── LiveCapture.jsx # Mic/aux streaming
│       └── hooks/
│           ├── useSocket.js   # Socket.IO connection
│           ├── useAudioSync.js # Clock sync + audio engine
│           └── useWebRTC.js   # WebRTC peer connections
└── README.md
```

## Latency Optimization Tips

- **Use WebSocket transport** (not HTTP polling) - already configured
- **Bluetooth codec matters**: aptX/aptX-LL codecs have lower latency (~40ms vs ~200ms for SBC)
- **Buffer size**: The 100ms coordination buffer can be tuned in `server/index.js`
- **Same WiFi network**: All users should be on the same local network for best sync

## Future Enhancements

- [ ] Spotify/YouTube integration via their APIs
- [ ] Persistent rooms with authentication
- [ ] Visualizer / waveform display
- [ ] Chat within rooms
- [ ] Mobile-optimized PWA
- [ ] TURN server for WebRTC behind strict NATs

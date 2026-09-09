# 🎵 Sonin - Listen Together

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

## Tests And Validation

### Artist Showcase

The entry screen includes 12 artist spotlights with local photos, crossfades,
slow camera motion, swipe navigation, artist selection, and pause controls.
Automatic motion stops with the operating system's reduced-motion preference,
when the page is hidden, or while interacting with the stage.

Photo sources, authors, and licenses are recorded in `client/src/artists.json`
and linked in the entry screen's Photo credits. The collection mixes concert
photos with verified portraits; it does not imply artist endorsement. Images
are cropped in the interface, and their individual licenses still apply.
Run `node scripts/fetch-artists.mjs` to refresh assets from Wikimedia Commons.
The refresh writes its manifest only after all downloads succeed.

```bash
npm install
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

The browser suite starts a local server when one is not already running. Build
the client before running it. It covers desktop and mobile room creation/joining,
invalid codes, uploads, actual HTML audio playback, seeking, late listeners,
permissions, chat, host handoff, provider-search races, and 320px layouts.
Screenshots and failure traces are written to `test-results/`.

Backend tests cover membership and reconnect permissions, playback state,
queue access checks, unique queue entries, upload validation, and HTTP ranges.

### Limits

- Foreground refreshes no longer restart an unchanged song. Small shared-audio
     drift is corrected gradually; delayed background clock samples are discarded.
     If the OS suspends audio entirely, catching up to the other listeners still
     skips the missed interval. YouTube background playback may be restricted by
     the browser/provider. This cannot be guaranteed away by website code.
- Deploy the server and client together for the passive-sync protocol changes.
     Local tests do not update or verify an existing hosted deployment.
- Public-provider searches time out after 15 seconds and display errors for
     upstream failures. Run `node scripts/check-providers.mjs https://your-site`
     for a live search availability check (not an account or audible-playback test).
     Search response time is not the same as inter-device audio latency.

- Tests use generated local audio and a controlled search response. Live external
     provider catalogs, Spotify Premium authentication, real Bluetooth timing,
     Safari/iOS autoplay behavior, and microphone/WebRTC capture require separate
     device/account testing. Third-party services can change or be unavailable.
- Rooms are in memory and disappear when the server restarts. Persistent browser
     IDs are not authentication. This remains a trusted-room prototype, not a
     production-hardened public service; authentication, rate limits, and upload
     retention policies are still needed for public deployment.
- Upload API clients must send their current room-member socket ID in the
     `x-socket-id` header. The bundled client supplies it automatically.
- The `qs` override pins a patched version until Express's dependency range
     includes that release. Review it when upgrading Express.

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

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
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
app.use('/uploads', express.static(uploadsDir, { maxAge: '1d', fallthrough: false }));

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

// Whether a given socket may control playback in a room:
// the host, anyone in collaborative mode, or a member the host granted control.
// Identity is resolved via the member's persistent userId so it survives
// socket reconnects (a reconnect gets a brand-new socket id).
function memberCanControl(room, socketId) {
  if (!room) return false;
  const member = room.members[socketId];
  if (!member) return false;
  if (room.hostUserId && member.userId === room.hostUserId) return true;
  if (room.mode === 'collaborative') return true;
  return !!member.canControl;
}

// Whether the given socket is the room host (by persistent userId).
function isRoomHost(room, socketId) {
  const member = room?.members[socketId];
  return !!member && room.hostUserId === member.userId;
}

// REST API
app.post('/api/upload/:roomId', (req, res, next) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.members[req.headers['x-socket-id']]) {
    return res.status(403).json({ error: 'Join the room before uploading music' });
  }
  next();
}, upload.single('audio'), (req, res) => {
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
    addedBy: room.members[req.headers['x-socket-id']]?.username || 'Listener'
  };

  room.queue.push(track);
  io.to(roomId).emit('queue:updated', room.queue);
  io.to(roomId).emit('queue:song-added', {
    name: track.name,
    addedBy: track.addedBy || 'Someone'
  });

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

// YouTube search.
//
// We scrape YouTube's public results page and parse the `ytInitialData` JSON
// blob it embeds. This needs no API key/quota and is far more resilient than
// the youtube-sr library, which periodically breaks when YouTube tweaks its
// internal markup (e.g. the "Cannot read properties of undefined (reading
// 'browseId')" failure). youtube-sr is kept only as a last-resort fallback.
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseDurationText(text) {
  // "3:45" -> 225, "1:02:33" -> 3753
  if (!text) return 0;
  const parts = String(text).split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function scrapeYouTubeSearch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`; // sp filter: videos only
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      // Skip the EU cookie-consent interstitial that otherwise replaces results.
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+700'
    }
  });
  if (!res.ok) throw new Error(`YouTube responded ${res.status}`);
  const html = await res.text();

  const split = html.split('var ytInitialData = ');
  if (split.length < 2) throw new Error('ytInitialData not found');
  const jsonStr = split[1].split(';</script>')[0];
  const data = JSON.parse(jsonStr);

  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];
  const results = [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item?.videoRenderer;
      if (!v || !v.videoId) continue;
      const title =
        v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown';
      const artist =
        v.ownerText?.runs?.[0]?.text ||
        v.longBylineText?.runs?.[0]?.text ||
        'Unknown';
      const durationText =
        v.lengthText?.simpleText || v.lengthText?.runs?.[0]?.text || '';
      const durationSec = parseDurationText(durationText);
      const thumbs = v.thumbnail?.thumbnails || [];
      const albumArt =
        thumbs[thumbs.length - 1]?.url ||
        `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`;
      results.push({
        id: v.videoId,
        uri: v.videoId,
        name: title,
        artist,
        album: '',
        albumArt,
        duration: durationSec * 1000,
        durationText: durationText || formatDuration(durationSec),
        platform: 'youtube'
      });
      if (results.length >= 15) return results;
    }
  }
  return results;
}

app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  // Primary: scrape ytInitialData (no API key, resilient).
  try {
    const results = await scrapeYouTubeSearch(query);
    if (results.length) return res.json({ results });
  } catch (err) {
    console.error('YouTube scrape error:', err.message);
  }

  // Fallback: youtube-sr (may be broken depending on YouTube markup).
  try {
    const videos = await YouTube.search(query + ' music', { limit: 10, type: 'video' });
    const results = videos.map(video => {
      const durationSec = Math.floor((video.duration || 0) / 1000);
      return {
        id: video.id,
        uri: video.id,
        name: video.title || 'Unknown',
        artist: video.channel?.name || 'Unknown',
        album: '',
        albumArt: video.thumbnail?.url || `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`,
        duration: video.duration || 0,
        durationText: formatDuration(durationSec),
        platform: 'youtube'
      };
    });
    res.json({ results });
  } catch (err) {
    console.error('YouTube search error:', err.message);
    res.status(502).json({ error: 'YouTube search is unavailable. Please try again.' });
  }
});

// --- Audius (free, full-song streaming, no login) ---
let audiusHostCache = null;
let audiusHostCacheTime = 0;
const AUDIUS_APP = 'Sonin';

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
    res.status(502).json({ error: 'Audius search is unavailable. Please try again.' });
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

// --- JioSaavn (free full-song streaming, huge Bollywood/Indian catalog) ---
// Uses JioSaavn's own backend API (reliable, no third-party mirror). Song
// stream URLs come back encrypted (DES) and are decrypted here. The result is
// a direct MP4/AAC stream URL that plays through the shared <audio> element, so
// tracks get full drift-corrected sync + background/lock-screen playback (the
// same reliable path as Audius) — ideal for group listening on 3+ devices.
const SAAVN_ENDPOINT = 'https://www.jiosaavn.com/api.php';
const SAAVN_DES_KEY = '38346591';

function decryptSaavnUrl(encrypted) {
  try {
    const decipher = crypto.createDecipheriv('des-ecb', Buffer.from(SAAVN_DES_KEY), null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    // Upgrade the default 96kbps URL to 320kbps.
    return decrypted.replace('_96.mp4', '_320.mp4');
  } catch (_) {
    return null;
  }
}

// Decode the HTML entities JioSaavn returns in titles/artist names.
function decodeEntities(str = '') {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function mapSaavnSong(song) {
  const info = song.more_info || {};
  const encrypted = info.encrypted_media_url || song.encrypted_media_url;
  const url = encrypted ? decryptSaavnUrl(encrypted) : null;

  let artist = decodeEntities(song.subtitle || '');
  const primary = info.artistMap?.primary_artists || info.artistMap?.artists;
  if (Array.isArray(primary) && primary.length) {
    artist = primary.map(a => decodeEntities(a.name)).join(', ');
  }

  const durationSec = Number(info.duration || song.duration || 0);
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;

  // Use the largest artwork available.
  const image = (song.image || '').replace('150x150', '500x500').replace('50x50', '500x500');

  // saavncdn.com aborts cross-origin <audio> media requests (hotlink
  // protection) even though a plain fetch works, so the browser can't play the
  // raw URL directly. Route it through our own /api/saavn/stream proxy instead.
  const streamUrl = url ? `/api/saavn/stream?u=${encodeURIComponent(url)}` : null;

  return {
    id: song.id,
    uri: song.id,
    name: decodeEntities(song.title || song.song || 'Unknown'),
    artist: artist || 'Unknown',
    album: decodeEntities(info.album || song.album || ''),
    albumArt: image,
    url: streamUrl, // proxied stream → shared <audio>, full sync + background
    duration: durationSec * 1000,
    durationText: `${mins}:${secs.toString().padStart(2, '0')}`,
    platform: 'saavn'
  };
}

app.get('/api/saavn/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const url = `${SAAVN_ENDPOINT}?__call=search.getResults&q=${encodeURIComponent(query)}` +
      `&_format=json&_marker=0&api_version=4&ctx=web6dot0&p=1&n=15`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Saavn search failed: ${response.status}`);
    const data = await response.json();
    const songs = data?.results || [];
    const results = songs
      .map(mapSaavnSong)
      .filter(t => !!t.url); // only keep playable results
    res.json({ results });
  } catch (err) {
    console.error('Saavn search error:', err.message);
    res.status(502).json({ error: 'Saavn search is unavailable. Please try again.' });
  }
});

// Proxy JioSaavn CDN audio. saavncdn.com aborts cross-origin <audio> media
// requests (hotlink protection) even though a plain fetch works, so the browser
// cannot play the raw stream. We fetch it server-side (which works) and stream
// it back from our own origin with proper HTTP Range support so seeking works.
app.get('/api/saavn/stream', async (req, res) => {
  const target = req.query.u;
  if (!target) return res.status(400).end('missing url');
  let host;
  try { host = new URL(target).hostname; } catch { return res.status(400).end('bad url'); }
  // Only allow proxying JioSaavn's own CDN (prevents open-proxy / SSRF abuse).
  if (!/(^|\.)saavncdn\.com$/i.test(host)) return res.status(403).end('forbidden host');
  try {
    const range = req.headers.range;
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        ...(range ? { Range: range } : {})
      }
    });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Saavn stream proxy error:', err.message);
    if (!res.headersSent) res.status(502).end('proxy error');
  }
});

// --- SoundCloud (free, huge English catalog, direct progressive MP3 streams) ---
// SoundCloud's public API needs a `client_id`, which is embedded in their web
// player's JS bundle. We scrape it once and cache it. Progressive transcodings
// resolve to a plain MP3 URL that plays through the shared <audio> element, so
// SoundCloud tracks get full drift-corrected sync + background playback for 3+
// listeners (unlike YouTube). Great for filling the English-song gap.
let scClientId = null;
let scClientIdAt = 0;

async function getSoundCloudClientId() {
  // Reuse a cached id for 6 hours (it rarely changes).
  if (scClientId && Date.now() - scClientIdAt < 6 * 60 * 60 * 1000) return scClientId;
  const ua = { 'User-Agent': 'Mozilla/5.0' };
  const home = await fetch('https://soundcloud.com/', { headers: ua });
  const html = await home.text();
  const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  // The client_id lives in one of the later bundles — check newest first.
  for (const url of scriptUrls.reverse()) {
    try {
      const js = await (await fetch(url, { headers: ua })).text();
      const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
      if (m) { scClientId = m[1]; scClientIdAt = Date.now(); return scClientId; }
    } catch (_) { /* try next bundle */ }
  }
  throw new Error('Could not resolve SoundCloud client_id');
}

app.get('/api/soundcloud/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });
  try {
    const clientId = await getSoundCloudClientId();
    const ua = { 'User-Agent': 'Mozilla/5.0' };
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}` +
      `&client_id=${clientId}&limit=20`;
    const response = await fetch(url, { headers: ua });
    if (!response.ok) throw new Error(`SoundCloud search failed: ${response.status}`);
    const data = await response.json();
    const collection = data.collection || [];

    const results = await Promise.all(collection.map(async (t) => {
      try {
        if (t.policy === 'BLOCK' || t.streamable === false) return null;
        // Prefer a progressive (plain MP3) transcoding so it plays in <audio>.
        const progressive = (t.media?.transcodings || [])
          .find(tr => tr.format?.protocol === 'progressive');
        if (!progressive) return null;
        const streamRes = await fetch(`${progressive.url}?client_id=${clientId}`, { headers: ua });
        if (!streamRes.ok) return null;
        const streamData = await streamRes.json();
        const streamUrl = streamData.url;
        if (!streamUrl) return null;

        const durationSec = Math.round((t.full_duration || t.duration || 0) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const art = (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500');

        return {
          id: `sc-${t.id}`,
          uri: `sc-${t.id}`,
          name: t.title || 'Unknown',
          artist: t.user?.username || 'Unknown',
          album: '',
          albumArt: art,
          url: streamUrl, // progressive MP3 → shared <audio>, full sync + background
          duration: durationSec * 1000,
          durationText: `${mins}:${secs.toString().padStart(2, '0')}`,
          platform: 'soundcloud'
        };
      } catch (_) { return null; }
    }));

    res.json({ results: results.filter(Boolean) });
  } catch (err) {
    console.error('SoundCloud search error:', err.message);
    res.status(502).json({ error: 'SoundCloud search is unavailable. Please try again.' });
  }
});


// --- Gaana (large Indian + some English catalog, HLS streams) ---
// Gaana returns AES-encrypted stream URLs that decrypt to an HLS (.m3u8)
// playlist. The client plays these through the shared <audio> element using
// hls.js, so Gaana tracks also sync for 3+ listeners. Unofficial endpoint —
// may break over time.
const GAANA_AES_KEY = 'g@1n!(f1#r.0$)&%';
const GAANA_AES_IV = 'asd!@#!@#@!12312';

function decryptGaanaUrl(encrypted) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(GAANA_AES_KEY), Buffer.from(GAANA_AES_IV));
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return null;
  }
}

function mapGaanaSong(song) {
  const encrypted = song?.urls?.high?.message || song?.urls?.medium?.message || song?.urls?.auto?.message;
  const url = encrypted ? decryptGaanaUrl(encrypted) : null;

  let artist = 'Unknown';
  if (Array.isArray(song.artist) && song.artist.length) {
    artist = song.artist.map(a => decodeEntities(a.name || a.seokey || '')).filter(Boolean).join(', ');
  } else if (typeof song.artist === 'string') {
    artist = decodeEntities(song.artist);
  }

  const durationSec = Number(song.duration || 0);
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const art = (song.artwork || song.atw || '').replace(/175x175|80x80/g, '480x480');

  return {
    id: `gaana-${song.track_id || song.seokey}`,
    uri: `gaana-${song.track_id || song.seokey}`,
    name: decodeEntities(song.track_title || song.title || 'Unknown'),
    artist: artist || 'Unknown',
    album: decodeEntities(song.album_title || ''),
    albumArt: art,
    url, // HLS (.m3u8) → played via hls.js into the shared <audio>
    duration: durationSec * 1000,
    durationText: `${mins}:${secs.toString().padStart(2, '0')}`,
    platform: 'gaana'
  };
}

app.get('/api/gaana/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });
  try {
    const ua = {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': 'https://gaana.com/'
    };
    // Search for song seokeys, then fetch full song details (which include the
    // encrypted stream URLs) for each.
    const searchUrl = 'https://apiv2.gaana.com/search/song/most-popular?keyword=' +
      encodeURIComponent(query) + '&page=0&limit=15';
    const searchRes = await fetch(searchUrl, { headers: ua });
    if (!searchRes.ok) throw new Error(`Gaana search failed: ${searchRes.status}`);
    const searchData = await searchRes.json();
    const items = searchData?.gr || searchData?.tracks || searchData?.data || [];

    const details = await Promise.all(items.slice(0, 15).map(async (it) => {
      const seokey = it.seokey || it.seo_key;
      if (!seokey) return null;
      try {
        const detailUrl = 'https://apiv2.gaana.com/song/detail?seokey=' + encodeURIComponent(seokey);
        const dRes = await fetch(detailUrl, { headers: ua });
        if (!dRes.ok) return null;
        const dData = await dRes.json();
        const song = (dData?.tracks && dData.tracks[0]) || dData?.track || dData;
        return song ? mapGaanaSong(song) : null;
      } catch (_) { return null; }
    }));

    res.json({ results: details.filter(t => t && t.url) });
  } catch (err) {
    console.error('Gaana search error:', err.message);
    res.json({ results: [] });
  }
});


// Socket.IO handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.use(([event, payload], next) => {
    if (event === 'clock:ping') return next();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || ('roomId' in payload && typeof payload.roomId !== 'string')) {
      socket.emit('error', { message: 'Invalid request' });
      return;
    }
    next();
  });

  // Clock synchronization
  socket.on('clock:ping', (clientTime) => {
    socket.emit('clock:pong', {
      clientTime,
      serverTime: Date.now()
    });
  });

  // Room management
  socket.on('room:create', ({ username, roomName, userId }) => {
    if (typeof username !== 'string' || !username.trim() || username.length > 20
      || (roomName != null && (typeof roomName !== 'string' || roomName.length > 30))
      || (userId != null && typeof userId !== 'string')) {
      socket.emit('error', { message: 'Enter a valid name and room name' });
      return;
    }
    const room = roomManager.createRoom(roomName, socket.id, username, userId);
    socket.join(room.id);
    socket.emit('room:created', room);
    socket.emit('room:state', roomManager.getRoomState(room.id));
  });

  socket.on('room:join', ({ roomId, username, userId }) => {
    if (typeof username !== 'string' || !username.trim() || username.length > 20
      || (userId != null && typeof userId !== 'string')) {
      socket.emit('error', { message: 'Enter a valid name' });
      return;
    }
    const normalizedId = roomId?.trim()?.toLowerCase();
    const room = roomManager.getRoom(normalizedId);
    if (!room) {
      socket.emit('error', {
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found. Check the code and try again.'
      });
      return;
    }

    // A (re)join cancels any pending host-reassignment grace timer.
    if (room._hostGraceTimer && room.hostUserId === userId) {
      clearTimeout(room._hostGraceTimer);
      room._hostGraceTimer = null;
    }
    // ...and any pending empty-room deletion timer, so a returning member keeps
    // the room alive.
    if (room._emptyTimer) { clearTimeout(room._emptyTimer); room._emptyTimer = null; }

    roomManager.addMember(normalizedId, socket.id, username, userId);
    socket.join(normalizedId);

    // Notify others (used for WebRTC offers), then broadcast the full state so
    // everyone's member list & host highlight refresh — this is what restores a
    // host's controls after they reconnect.
    io.to(normalizedId).emit('room:member-joined', { id: socket.id, username });
    io.to(normalizedId).emit('room:state', roomManager.getRoomState(normalizedId));

    // If something is already playing, send the current sync state to the new
    // listener so they can catch up mid-song (with a recalculated position).
    if (room.playbackState && room.playbackState.playing) {
      const now = Date.now();
      const syncTime = now + 200; // coordination buffer
      const elapsed = (syncTime - room.playbackState.startedAt) / 1000;
      socket.emit('playback:sync', {
        ...room.playbackState,
        snapshot: true,
        position: (room.playbackState.position || 0) + Math.max(0, elapsed),
        startedAt: syncTime,
        syncTime
      });
    } else if (room.playbackState) {
      socket.emit('playback:sync', { ...room.playbackState, snapshot: true });
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
    if (!memberCanControl(room, socket.id)) {
      socket.emit('error', { message: 'You do not have permission to control playback' });
      return;
    }

    if (!Number.isInteger(trackIndex) || !room.queue[trackIndex]
      || (position != null && (!Number.isFinite(position) || position < 0))) return;
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

    if (!memberCanControl(room, socket.id)) {
      socket.emit('error', { message: 'You do not have permission to control playback' });
      return;
    }

    const now = Date.now();
    const elapsed = room.playbackState.playing
      ? Math.max(0, (now - room.playbackState.startedAt) / 1000) : 0;
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

    if (!memberCanControl(room, socket.id)) return;
    if (!Number.isFinite(position) || position < 0 || !room.queue.length) return;

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
    if (!memberCanControl(room, socket.id)) return;
    if (!room.queue || room.queue.length === 0) return;

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

  // A device that joins mid-song (or re-enables audio on mobile) can request
  // the current playback state so it starts playing in sync.
  socket.on('playback:request-sync', ({ roomId }) => {
    const normalizedId = roomId?.trim()?.toLowerCase();
    const room = roomManager.getRoom(normalizedId);
    if (!room || !room.members[socket.id] || !room.playbackState) return;
    const ps = room.playbackState;
    if (!ps.playing) {
      socket.emit('playback:sync', { ...ps, snapshot: true });
      return;
    }
    const now = Date.now();
    const syncTime = now + 200;
    const elapsed = (syncTime - (ps.startedAt || now)) / 1000;
    socket.emit('playback:sync', {
      ...ps,
      snapshot: true,
      position: (ps.position || 0) + Math.max(0, elapsed),
      startedAt: syncTime,
      syncTime
    });
  });

  // Queue management
  socket.on('queue:add-platform-track', ({ roomId, track }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !room.members[socket.id]) return;
    if (!track || typeof track.name !== 'string' || !track.name.trim()
      || !['youtube', 'spotify', 'audius', 'saavn', 'soundcloud', 'gaana'].includes(track.platform)
      || (track.url != null && (typeof track.url !== 'string'
        || (!/^https?:\/\//i.test(track.url)
          && !(track.platform === 'saavn' && track.url.startsWith('/api/saavn/stream?')))))
      || (track.uri != null && typeof track.uri !== 'string')) return;
    // Add streaming platform track to queue
    room.queue.push({
      id: uuidv4(),
      name: track.name,
      artist: track.artist,
      album: track.album,
      albumArt: track.albumArt,
      uri: track.uri,
      url: track.url || null, // Audius provides a direct stream URL; Spotify/YT don't
      duration: track.duration,
      platform: track.platform,
      addedBy: room.members[socket.id].username
    });
    io.to(roomId).emit('queue:updated', room.queue);
    // Notify everyone (a small pop-up) that a song was added to the queue.
    io.to(roomId).emit('queue:song-added', {
      name: track.name,
      addedBy: room.members[socket.id].username
    });
  });

  socket.on('queue:reorder', ({ roomId, queue }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !memberCanControl(room, socket.id) || !Array.isArray(queue)) return;
    const tracks = new Map(room.queue.map(track => [track.id, track]));
    if (queue.length !== tracks.size || new Set(queue.map(track => track?.id)).size !== tracks.size
      || queue.some(track => !tracks.has(track?.id))) return;
    const activeId = room.queue[room.playbackState.trackIndex]?.id;
    room.queue = queue.map(track => tracks.get(track.id));
    room.playbackState.trackIndex = Math.max(0, room.queue.findIndex(track => track.id === activeId));
    io.to(roomId).emit('queue:updated', room.queue);
  });

  socket.on('queue:remove', ({ roomId, trackId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !memberCanControl(room, socket.id)) return;
    const removedIndex = room.queue.findIndex(t => t.id === trackId);
    if (removedIndex === -1) return;
    room.queue = room.queue.filter(t => t.id !== trackId);
    io.to(roomId).emit('queue:updated', room.queue);

    // Keep playbackState.trackIndex pointing at the correct track after removal.
    const ps = room.playbackState;
    if (!ps) return;

    if (removedIndex < ps.trackIndex) {
      // An earlier song was removed — the same track keeps playing, just shift
      // its index down (position is preserved).
      ps.trackIndex = Math.max(0, ps.trackIndex - 1);
    } else if (removedIndex === ps.trackIndex) {
      // The currently-playing track was removed. A different song now occupies
      // this index, so restart it from the beginning instead of inheriting the
      // removed song's elapsed time.
      if (room.queue.length === 0) {
        ps.playing = false;
        ps.position = 0;
        ps.trackIndex = 0;
        ps.startedAt = null;
        ps.updatedAt = Date.now();
        io.to(roomId).emit('playback:sync', { ...ps });
        return;
      }
      ps.trackIndex = Math.min(ps.trackIndex, room.queue.length - 1);
      const syncTime = Date.now() + 100;
      room.playbackState = {
        playing: ps.playing,
        trackIndex: ps.trackIndex,
        position: 0,
        startedAt: syncTime,
        updatedAt: syncTime
      };
      io.to(roomId).emit('playback:sync', { ...room.playbackState, syncTime });
    }
  });

  // Mode switching
  socket.on('room:set-mode', ({ roomId, mode }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !isRoomHost(room, socket.id)) return;
    if (!['host', 'collaborative'].includes(mode)) return;
    room.mode = mode;
    io.to(roomId).emit('room:mode-changed', mode);
  });

  // Grant/revoke playback control for a specific member (host only)
  socket.on('room:set-control', ({ roomId, memberId, allowed }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !isRoomHost(room, socket.id)) return;
    if (memberId === room.hostId) return; // host always has control
    if (!roomManager.setMemberControl(roomId, memberId, allowed)) return;
    io.to(roomId).emit('room:control-changed', { memberId, allowed: !!allowed });
  });

  // Kick a member (host only)
  socket.on('room:kick', ({ roomId, memberId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room || !isRoomHost(room, socket.id)) return;
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
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) return;

    const member = room.members[socket.id];
    io.to(roomId).emit('chat:message', {
      // Persistent userId so "my message" alignment survives reconnects.
      userId: member.userId,
      username: member.username,
      message: message.trim(),
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
    rooms.forEach(roomId => handleLeaveRoom(socket, roomId, true));
  });
});

function handleLeaveRoom(socket, roomId, isDisconnect = false) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const wasHost = isRoomHost(room, socket.id);
  roomManager.removeMember(roomId, socket.id);
  socket.leave(roomId);
  io.to(roomId).emit('room:member-left', { id: socket.id });

  const remaining = Object.keys(room.members);
  if (remaining.length === 0) {
    // No one is connected. Keep the room alive for a while so a member who just
    // backgrounded their phone / dropped connection can return and find it —
    // only delete it if it's still empty after the grace window.
    // (An explicit "leave" clears out much sooner than an involuntary drop.)
    if (room._emptyTimer) clearTimeout(room._emptyTimer);
    const graceMs = isDisconnect ? 30 * 60 * 1000 : 10 * 1000; // 30 min vs 10 s
    room._emptyTimer = setTimeout(() => {
      const r = roomManager.getRoom(roomId);
      if (r && Object.keys(r.members).length === 0) roomManager.deleteRoom(roomId);
    }, graceMs);
    return;
  }

  if (!wasHost) return;

  // Reassign the host to the earliest-joined remaining member — but only if the
  // original host doesn't come back (by persistent userId).
  const reassignHost = () => {
    const r = roomManager.getRoom(roomId);
    if (!r) return;
    if (Object.values(r.members).some(m => m.userId === r.hostUserId)) return; // reclaimed
    const ids = Object.keys(r.members);
    if (!ids.length) return;
    const newHostSocket = ids[0];
    r.hostId = newHostSocket;
    r.hostUserId = r.members[newHostSocket].userId;
    r.members[newHostSocket].canControl = true;
    io.to(roomId).emit('room:host-changed', { newHostId: r.hostId, newHostUserId: r.hostUserId });
    io.to(roomId).emit('room:state', roomManager.getRoomState(roomId));
  };

  if (isDisconnect) {
    // Give the host a window to reconnect before handing off control.
    if (room._hostGraceTimer) clearTimeout(room._hostGraceTimer);
    room._hostGraceTimer = setTimeout(reassignHost, 45000);
  } else {
    reassignHost();
  }
}

const PORT = process.env.PORT || 3001;

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 400;
  res.status(status).json({ error: error.message || 'Request failed' });
});

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
  console.log(`🎵 Sync-Stream server running on http://localhost:${server.address().port}`);
});

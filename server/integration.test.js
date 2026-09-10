import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';

let processHandle;
let baseUrl;
const sockets = [];

function eventFrom(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5000);
    const handler = value => { clearTimeout(timer); resolve(value); };
    socket.once(event, handler);
  });
}

async function connect() {
  const socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await eventFrom(socket, 'connect');
  return socket;
}

async function roomFor(socket) {
  const state = eventFrom(socket, 'room:state');
  socket.emit('room:create', { username: 'Host', userId: socket.id });
  return state;
}

async function addTrack(socket, roomId) {
  const result = eventFrom(socket, 'queue:updated');
  socket.emit('queue:add-platform-track', {
    roomId, track: { id: 'same-source', name: 'Test song', platform: 'youtube', uri: 'test-video' }
  });
  return result;
}

async function sync(socket, roomId) {
  const result = eventFrom(socket, 'playback:sync');
  socket.emit('playback:request-sync', { roomId });
  return result;
}

before(async () => {
  processHandle = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    processHandle.once('error', reject);
    processHandle.stdout.on('data', data => {
      const match = data.toString().match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
});

after(async () => {
  sockets.forEach(socket => socket.disconnect());
  if (processHandle && processHandle.exitCode === null) {
    const exited = once(processHandle, 'exit');
    processHandle.kill();
    await exited;
  }
});

test('removed Spotify source cannot be queued and its token API is unavailable', async () => {
  const host = await connect();
  const room = await roomFor(host);
  host.emit('queue:add-platform-track', {
    roomId: room.id,
    track: { id: 'removed-source', name: 'Removed source', platform: 'spotify', uri: 'spotify:track:test' }
  });
  const queue = await addTrack(host, room.id);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].platform, 'youtube');
  const config = await fetch(`${baseUrl}/api/platforms/config`).then(response => response.json());
  assert.equal(Object.hasOwn(config, 'spotify'), false);
  const token = await fetch(`${baseUrl}/api/platforms/spotify/token`, { method: 'POST' });
  assert.equal(token.status, 404);
});

test('pausing idle or already-paused playback never advances position', async () => {
  const host = await connect();
  const room = await roomFor(host);
  for (const attempt of [1, 2]) {
    const result = eventFrom(host, 'playback:sync');
    host.emit('playback:pause', { roomId: room.id });
    assert.equal((await result).position, 0, `pause ${attempt}`);
  }
});

test('queue entries have unique IDs and removing the final song broadcasts stop', async () => {
  const host = await connect();
  const room = await roomFor(host);
  await addTrack(host, room.id);
  const tracks = await addTrack(host, room.id);
  assert.notEqual(tracks[0].id, tracks[1].id);
  let updated = eventFrom(host, 'queue:updated');
  const removedSync = eventFrom(host, 'playback:sync');
  host.emit('queue:remove', { roomId: room.id, trackId: tracks[0].id });
  assert.equal((await updated).length, 1);
  await removedSync;
  const played = eventFrom(host, 'playback:sync');
  host.emit('playback:play', { roomId: room.id, trackIndex: 0, position: 0 });
  assert.equal((await played).playing, true);
  const stopped = eventFrom(host, 'playback:sync');
  host.emit('queue:remove', { roomId: room.id, trackId: tracks[1].id });
  assert.deepEqual({ ...await stopped, snapshot: true }, await sync(host, room.id));
  assert.equal((await sync(host, room.id)).playing, false);
});

test('outsiders cannot add tracks and listeners cannot remove tracks', async () => {
  const host = await connect();
  const outsider = await connect();
  const room = await roomFor(host);
  const tracks = await addTrack(host, room.id);
  outsider.emit('queue:add-platform-track', {
    roomId: room.id, track: { name: 'Intrusion', platform: 'youtube', uri: 'test-video' }
  });
  const joined = eventFrom(outsider, 'room:state');
  outsider.emit('room:join', { roomId: room.id.toUpperCase(), username: 'Guest' });
  assert.equal((await joined).queue.length, 1);
  outsider.emit('queue:remove', { roomId: room.id, trackId: tracks[0].id });
  const refreshed = eventFrom(outsider, 'room:state');
  outsider.emit('room:join', { roomId: room.id, username: 'Guest' });
  assert.equal((await refreshed).queue.length, 1);
});

test('invalid playback and malformed events do not corrupt state or crash server', async () => {
  const host = await connect();
  const room = await roomFor(host);
  host.emit('playback:play', { roomId: room.id, trackIndex: -1, position: -20 });
  assert.equal((await sync(host, room.id)).playing, false);
  const error = eventFrom(host, 'error');
  host.emit('room:join', null);
  assert.equal((await error).message, 'Invalid request');
  assert.equal((await fetch(`${baseUrl}/api/rooms`)).status, 200);
});

test('uploads enforce room membership and return structured errors', async () => {
  const host = await connect();
  const room = await roomFor(host);
  const denied = await fetch(`${baseUrl}/api/upload/${room.id}`, { method: 'POST' });
  assert.equal(denied.status, 403);
  const form = new FormData();
  form.append('audio', new Blob(['not audio']), 'test.txt');
  const invalid = await fetch(`${baseUrl}/api/upload/${room.id}`, {
    method: 'POST', headers: { 'x-socket-id': host.id }, body: form
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /audio/);
});

test('uploaded files support suffix ranges and reject unsatisfiable ranges', async () => {
  const host = await connect();
  const room = await roomFor(host);
  const form = new FormData();
  form.append('audio', new Blob(['0123456789'], { type: 'audio/wav' }), 'range.wav');
  const upload = await fetch(`${baseUrl}/api/upload/${room.id}`, {
    method: 'POST', headers: { 'x-socket-id': host.id }, body: form
  });
  assert.equal(upload.status, 200);
  const { track } = await upload.json();
  const suffix = await fetch(`${baseUrl}${track.url}`, { headers: { Range: 'bytes=-3' } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
  assert.match(suffix.headers.get('content-type'), /audio\/wav/);
  assert.equal(await suffix.text(), '789');
  const invalid = await fetch(`${baseUrl}${track.url}`, { headers: { Range: 'bytes=100-200' } });
  assert.equal(invalid.status, 416);
  assert.equal((await fetch(`${baseUrl}/api/rooms`)).status, 200);
});

test('rejoining a paused room receives the authoritative paused playback snapshot', async () => {
  const host = await connect();
  const guest = await connect();
  const room = await roomFor(host);
  await addTrack(host, room.id);
  const played = eventFrom(host, 'playback:sync');
  host.emit('playback:play', { roomId: room.id, trackIndex: 0, position: 8 });
  await played;
  const paused = eventFrom(host, 'playback:sync');
  host.emit('playback:pause', { roomId: room.id });
  const expected = await paused;
  const restored = eventFrom(guest, 'playback:sync');
  guest.emit('room:join', { roomId: room.id, username: 'Returning guest', userId: 'returning-guest' });
  const actual = await restored;
  assert.equal(actual.playing, false);
  assert.equal(actual.position, expected.position);
  assert.equal(actual.updatedAt, expected.updatedAt);
  assert.equal(actual.snapshot, true);
});

test('Saavn proxy tracks are accepted into the queue', async () => {
  const host = await connect();
  const room = await roomFor(host);
  const updated = eventFrom(host, 'queue:updated');
  const url = '/api/saavn/stream?u=https%3A%2F%2Fac.saavncdn.com%2Ftest.mp4';
  host.emit('queue:add-platform-track', {
    roomId: room.id,
    track: { name: 'Saavn song', platform: 'saavn', uri: 'saavn-test', url }
  });
  assert.equal((await updated)[0].url, url);
});
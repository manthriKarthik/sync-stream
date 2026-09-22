import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './rooms.js';

test('completion advances once at the song boundary without a host callback', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Background', 'host', 'Host');
  room.queue = [{ id: 'first', duration: 30000 }, { id: 'next', duration: 30000 }];
  room.playbackState = { playing: true, trackIndex: 0, position: 0, startedAt: 1000, updatedAt: 1000 };
  const report = { trackId: 'first', updatedAt: 1000, duration: 5 };
  assert.equal(manager.completeTrack(room.id, report, 6000), null);
  assert.equal(manager.completeTrack(room.id, { ...report, trackId: 'wrong' }, 31000), null);
  const next = manager.completeTrack(room.id, report, 31000);
  assert.equal(next.trackIndex, 1);
  assert.equal(next.position, 0);
  assert.equal(next.playing, true);
  assert.equal(manager.completeTrack(room.id, report, 31001), null);
  room.playbackState.playing = false;
  assert.equal(manager.completeTrack(room.id, { trackId: 'next', updatedAt: next.updatedAt }, 100000), null);
});

test('unknown-duration tracks use a listener duration and single-track repeats reject stale completion', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Upload', 'host', 'Host');
  room.queue = [{ id: 'upload' }];
  room.playbackState = { playing: true, trackIndex: 0, position: 20, startedAt: 1000, updatedAt: 1000 };
  const report = { trackId: 'upload', updatedAt: 1000, duration: 30 };
  assert.equal(manager.completeTrack(room.id, { ...report, duration: NaN }, 11000), null);
  assert.equal(manager.completeTrack(room.id, report, 2000), null);
  assert.equal(manager.completeTrack(room.id, report, 11000).trackIndex, 0);
  assert.equal(manager.completeTrack(room.id, report, 11001), null);
});

test('repeated joins preserve granted controls and membership time', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Test room', 'host', 'Host', 'host-user');
  manager.addMember(room.id, 'listener', 'Listener', 'listener-user');
  manager.setMemberControl(room.id, 'listener', true);
  room.members.listener.joinedAt = 123;

  manager.addMember(room.id, 'listener', 'Listener', 'listener-user');

  assert.equal(room.members.listener.canControl, true);
  assert.equal(room.members.listener.joinedAt, 123);
  assert.equal(Object.keys(room.members).length, 2);
});

test('reconnecting members retain controls without duplicate membership', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Test room', 'host', 'Host', 'host-user');
  manager.addMember(room.id, 'old-listener', 'Listener', 'listener-user');
  manager.setMemberControl(room.id, 'old-listener', true);
  manager.addMember(room.id, 'new-listener', 'Listener', 'listener-user');

  assert.equal(room.members['old-listener'], undefined);
  assert.equal(room.members['new-listener'].canControl, true);
  assert.equal(Object.keys(room.members).length, 2);
});

test('reconnecting host reclaims the host socket', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Test room', 'old-host', 'Host', 'host-user');
  manager.addMember(room.id, 'new-host', 'Host', 'host-user');

  assert.equal(room.hostId, 'new-host');
  assert.equal(room.members['old-host'], undefined);
  assert.equal(manager.getRoomState(room.id).members[0].isHost, true);
});

test('granted controls survive a full disconnect and revoked controls stay revoked', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Test room', 'host', 'Host', 'host-user');
  manager.addMember(room.id, 'listener', 'Listener', 'listener-user');
  manager.setMemberControl(room.id, 'listener', true);
  manager.removeMember(room.id, 'listener');
  manager.addMember(room.id, 'reconnected', 'Listener', 'listener-user');
  assert.equal(room.members.reconnected.canControl, true);
  manager.setMemberControl(room.id, 'reconnected', false);
  manager.removeMember(room.id, 'reconnected');
  manager.addMember(room.id, 'again', 'Listener', 'listener-user');
  assert.equal(room.members.again.canControl, false);
});

test('fair queue interleaves tracks round-robin by user as listeners are added', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Fair', 'host', 'User1', 'u1');
  manager.setQueueMode(room.id, 'fair');

  // User1 adds five songs, then User2 adds one — it slots after User1's first.
  for (const name of ['A1', 'A2', 'A3', 'A4', 'A5']) {
    manager.enqueue(room.id, { id: name, name, addedBy: 'User1' });
  }
  manager.enqueue(room.id, { id: 'B1', name: 'B1', addedBy: 'User2' });
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'B1', 'A2', 'A3', 'A4', 'A5']);

  // User2 adds a second song — pairs up in the second round.
  manager.enqueue(room.id, { id: 'B2', name: 'B2', addedBy: 'User2' });
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'B1', 'A2', 'B2', 'A3', 'A4', 'A5']);

  // A third user's first song joins the first round after the existing users.
  manager.enqueue(room.id, { id: 'C1', name: 'C1', addedBy: 'User3' });
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'B1', 'C1', 'A2', 'B2', 'A3', 'A4', 'A5']);
});

test('fair queue keeps the currently-playing track and played tracks locked', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Fair', 'host', 'User1', 'u1');
  manager.setQueueMode(room.id, 'fair');
  for (const name of ['A1', 'A2', 'A3']) {
    manager.enqueue(room.id, { id: name, name, addedBy: 'User1' });
  }
  // A1 is now playing; a new user's track must not jump ahead of it.
  room.playbackState.playing = true;
  room.playbackState.trackIndex = 0;
  manager.enqueue(room.id, { id: 'B1', name: 'B1', addedBy: 'User2' });
  assert.equal(room.queue[0].id, 'A1');
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'B1', 'A2', 'A3']);
});

test('switching to fair mode re-orders an existing sequential queue', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Fair', 'host', 'User1', 'u1');
  manager.enqueue(room.id, { id: 'A1', name: 'A1', addedBy: 'User1' });
  manager.enqueue(room.id, { id: 'A2', name: 'A2', addedBy: 'User1' });
  manager.enqueue(room.id, { id: 'B1', name: 'B1', addedBy: 'User2' });
  // Sequential leaves the add order untouched.
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'A2', 'B1']);
  manager.setQueueMode(room.id, 'fair');
  assert.deepEqual(room.queue.map(t => t.id), ['A1', 'B1', 'A2']);
});
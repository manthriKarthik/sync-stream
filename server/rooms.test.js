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

test('member mute state is shared in room state and survives reconnect', () => {
  const manager = new RoomManager();
  const room = manager.createRoom('Test room', 'host', 'Host', 'host-user');
  manager.addMember(room.id, 'listener', 'Listener', 'listener-user');

  const before = manager.getRoomState(room.id).members.find(m => m.id === 'listener');
  assert.equal(before.muted, false);

  assert.equal(manager.setMemberMute(room.id, 'listener', true), true);
  const muted = manager.getRoomState(room.id).members.find(m => m.id === 'listener');
  assert.equal(muted.muted, true);

  manager.addMember(room.id, 'listener-2', 'Listener', 'listener-user');
  assert.equal(room.members['listener-2'].muted, true);

  assert.equal(manager.setMemberMute(room.id, 'listener-2', false), true);
  assert.equal(room.members['listener-2'].muted, false);
  assert.equal(manager.setMemberMute(room.id, 'ghost', true), false);
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
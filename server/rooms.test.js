import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './rooms.js';

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
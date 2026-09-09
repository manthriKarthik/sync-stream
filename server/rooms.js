import { v4 as uuidv4 } from 'uuid';

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(name, hostSocketId, hostUsername, hostUserId) {
    const id = uuidv4().slice(0, 8).toLowerCase(); // Lowercase for case-insensitive matching
    const uid = hostUserId || hostSocketId;
    const room = {
      id,
      name: name || `${hostUsername}'s Room`,
      hostId: hostSocketId,
      // Persistent identity of the host (survives socket reconnects). Control
      // and "is host" checks use this, not the volatile socket id.
      hostUserId: uid,
      mode: 'host', // 'host' or 'collaborative'
      members: {
        [hostSocketId]: { username: hostUsername, userId: uid, joinedAt: Date.now(), canControl: true }
      },
      memberPermissions: new Map(),
      queue: [],
      playbackState: {
        playing: false,
        trackIndex: 0,
        position: 0,
        startedAt: null,
        updatedAt: Date.now()
      },
      createdAt: Date.now()
    };

    this.rooms.set(id, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      hostUserId: room.hostUserId,
      mode: room.mode,
      members: Object.entries(room.members).map(([id, data]) => ({
        id,
        userId: data.userId,
        username: data.username,
        joinedAt: data.joinedAt,
        isHost: data.userId === room.hostUserId,
        canControl: data.userId === room.hostUserId ? true : !!data.canControl
      })),
      queue: room.queue,
      playbackState: room.playbackState
    };
  }

  addMember(roomId, socketId, username, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const uid = userId || socketId;
    // Drop any stale entry for the same persistent user (a reconnect arrives
    // with a NEW socket id) and carry over its control permission.
    let priorControl = !!room.members[socketId]?.canControl || !!room.memberPermissions.get(uid);
    let joinedAt = room.members[socketId]?.joinedAt ?? Date.now();
    for (const [sid, m] of Object.entries(room.members)) {
      if (m.userId === uid && sid !== socketId) {
        priorControl = priorControl || !!m.canControl;
        joinedAt = m.joinedAt;
        delete room.members[sid];
      }
    }
    const isHostUser = room.hostUserId === uid;
    room.members[socketId] = {
      username,
      userId: uid,
      joinedAt,
      canControl: isHostUser ? true : priorControl
    };
    // Reclaim host: repoint the room's current host socket at the reconnected
    // host so playback control works again after a break/reconnect.
    if (isHostUser) room.hostId = socketId;
    return true;
  }

  // Grant or revoke a specific member's playback-control permission (host only).
  setMemberControl(roomId, memberId, allowed) {
    const room = this.rooms.get(roomId);
    if (!room || !room.members[memberId]) return false;
    room.members[memberId].canControl = !!allowed;
    room.memberPermissions.set(room.members[memberId].userId, !!allowed);
    return true;
  }

  removeMember(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    delete room.members[socketId];
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  getRoomsForSocket(socketId) {
    const result = [];
    for (const [roomId, room] of this.rooms) {
      if (room.members[socketId]) {
        result.push(roomId);
      }
    }
    return result;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: Object.keys(room.members).length,
      mode: room.mode,
      isPlaying: room.playbackState.playing
    }));
  }
}

import { v4 as uuidv4 } from 'uuid';

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(name, hostSocketId, hostUsername) {
    const id = uuidv4().slice(0, 8).toLowerCase(); // Lowercase for case-insensitive matching
    const room = {
      id,
      name: name || `${hostUsername}'s Room`,
      hostId: hostSocketId,
      mode: 'host', // 'host' or 'collaborative'
      members: {
        [hostSocketId]: { username: hostUsername, joinedAt: Date.now() }
      },
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
      mode: room.mode,
      members: Object.entries(room.members).map(([id, data]) => ({
        id,
        ...data,
        isHost: id === room.hostId,
        canControl: id === room.hostId ? true : !!data.canControl
      })),
      queue: room.queue,
      playbackState: room.playbackState
    };
  }

  addMember(roomId, socketId, username) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.members[socketId] = { username, joinedAt: Date.now(), canControl: false };
    return true;
  }

  // Grant or revoke a specific member's playback-control permission (host only).
  setMemberControl(roomId, memberId, allowed) {
    const room = this.rooms.get(roomId);
    if (!room || !room.members[memberId]) return false;
    room.members[memberId].canControl = !!allowed;
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

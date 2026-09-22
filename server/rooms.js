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
      // 'sequential' = play in the order added; 'fair' = round-robin by user so
      // every listener's tracks are interleaved evenly (a "user queue").
      queueMode: 'sequential',
      _seq: 0, // monotonic arrival counter for stable fair-queue ordering
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

  completeTrack(roomId, { trackId, updatedAt, duration } = {}, now = Date.now()) {
    const room = this.rooms.get(roomId);
    const state = room?.playbackState;
    const track = room?.queue[state?.trackIndex];
    if (!state?.playing || !track || track.id !== trackId || state.updatedAt !== updatedAt) return null;
    const durationSeconds = Number.isFinite(track.duration) && track.duration > 0
      ? track.duration / 1000 : duration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    const position = state.position + Math.max(0, (now - state.startedAt) / 1000);
    if (position < durationSeconds - 0.25) return null;
    const syncTime = Math.max(now + 100, state.updatedAt + 1);
    room.playbackState = {
      playing: true,
      trackIndex: (state.trackIndex + 1) % room.queue.length,
      position: 0,
      startedAt: syncTime,
      updatedAt: syncTime
    };
    return { ...room.playbackState, syncTime };
  }

  // Add a track to a room's queue. In 'fair' mode the queue is re-interleaved
  // round-robin by the adding user; in 'sequential' mode it's appended.
  enqueue(roomId, track) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    track.seq = ++room._seq;
    room.queue.push(track);
    if (room.queueMode === 'fair') this.applyFairOrder(room);
    return room.queue;
  }

  setQueueMode(roomId, mode) {
    const room = this.rooms.get(roomId);
    if (!room || !['sequential', 'fair'].includes(mode)) return false;
    room.queueMode = mode;
    if (mode === 'fair') this.applyFairOrder(room);
    return true;
  }

  // Re-order the upcoming tracks so each user's songs are spread out fairly:
  // round 1 of every user, then round 2, etc. The currently-playing track and
  // everything before it stay locked in place. Ordering is stable via each
  // track's arrival `seq`, so the result is deterministic as users are added.
  applyFairOrder(room) {
    const queue = room.queue;
    if (queue.length <= 1) return;
    const ps = room.playbackState;
    const activeIndex = ps?.trackIndex ?? 0;
    const lockedCount = Math.min(activeIndex + 1, queue.length);
    const activeId = queue[activeIndex]?.id;

    // Compute each track's round (its 0-based position within its owner's list)
    // across the WHOLE queue, plus each user's earliest arrival, using seq.
    const bySeq = [...queue].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const roundOf = new Map();
    const firstSeqOf = new Map();
    const counter = new Map();
    for (const t of bySeq) {
      const owner = t.addedBy || 'unknown';
      if (!firstSeqOf.has(owner)) firstSeqOf.set(owner, t.seq || 0);
      const r = counter.get(owner) || 0;
      roundOf.set(t.id, r);
      counter.set(owner, r + 1);
    }

    const locked = queue.slice(0, lockedCount);
    const pending = queue.slice(lockedCount);
    pending.sort((a, b) => {
      const ra = roundOf.get(a.id) ?? 0;
      const rb = roundOf.get(b.id) ?? 0;
      if (ra !== rb) return ra - rb;
      const fa = firstSeqOf.get(a.addedBy || 'unknown') ?? 0;
      const fb = firstSeqOf.get(b.addedBy || 'unknown') ?? 0;
      if (fa !== fb) return fa - fb;
      return (a.seq || 0) - (b.seq || 0);
    });
    room.queue = [...locked, ...pending];
    if (activeId && ps) {
      const idx = room.queue.findIndex(t => t.id === activeId);
      if (idx >= 0) ps.trackIndex = idx;
    }
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
      queueMode: room.queueMode,
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

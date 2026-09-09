export function isUnchangedSnapshot(previous, next) {
  return next?.snapshot === true
    && previous != null
    && Number.isFinite(previous.updatedAt)
    && previous.updatedAt === next.updatedAt
    && previous.trackIndex === next.trackIndex
    && previous.playing === next.playing;
}

export function measureClockOffset(clientTime, serverTime, receivedAt) {
  const roundTrip = receivedAt - clientTime;
  if (![clientTime, serverTime, receivedAt].every(Number.isFinite)
    || roundTrip < 0 || roundTrip > 1000) return null;
  return serverTime + roundTrip / 2 - receivedAt;
}

export function driftPlaybackRate(drift) {
  if (!Number.isFinite(drift) || Math.abs(drift) <= 0.08) return 1;
  return drift > 0 ? 1.03 : 0.97;
}
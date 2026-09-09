export class ClockSyncHandler {
  // Server-side clock sync helper
  // The actual sync happens via socket events (clock:ping/pong)
  // This class can be extended for more sophisticated NTP-like algorithms

  getServerTime() {
    return Date.now();
  }

  // Calculate a future timestamp for coordinated playback start
  // Adds buffer time to account for network propagation
  getCoordinatedStartTime(bufferMs = 150) {
    return Date.now() + bufferMs;
  }
}

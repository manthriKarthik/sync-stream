import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnchangedSnapshot, measureClockOffset, driftPlaybackRate } from '../client/src/hooks/playbackSync.js';

const playing = { playing: true, trackIndex: 1, position: 10, updatedAt: 1000 };

test('foreground snapshots preserve playback despite a recalculated position', () => {
  assert.equal(isUnchangedSnapshot(playing, { ...playing, snapshot: true, position: 42 }), true);
});

test('explicit commands, missed updates, and first sync are always applied', () => {
  assert.equal(isUnchangedSnapshot(playing, { ...playing, position: 42 }), false);
  assert.equal(isUnchangedSnapshot(playing, { ...playing, snapshot: true, updatedAt: 2000 }), false);
  assert.equal(isUnchangedSnapshot(playing, { ...playing, snapshot: true, trackIndex: 2 }), false);
  assert.equal(isUnchangedSnapshot(playing, { ...playing, snapshot: true, playing: false }), false);
  assert.equal(isUnchangedSnapshot(null, { ...playing, snapshot: true }), false);
});

test('background-delayed or invalid clock samples do not change the clock', () => {
  assert.equal(measureClockOffset(1000, 1150, 1100), 100);
  assert.equal(measureClockOffset(1000, 1150, 8000), null);
  assert.equal(measureClockOffset(1000, 1150, 900), null);
  assert.equal(measureClockOffset(1000, NaN, 1100), null);
});

test('small drift uses gentle rate correction and resets to normal when aligned', () => {
  assert.equal(driftPlaybackRate(1.2), 1.03);
  assert.equal(driftPlaybackRate(-1.2), 0.97);
  assert.equal(driftPlaybackRate(0.02), 1);
  assert.equal(driftPlaybackRate(NaN), 1);
});
import { describe, expect, it } from 'vitest';
import { AudioTimeline } from './audioTimeline';

describe('AudioTimeline', () => {
  it('maps a performance timestamp into audio time', () => {
    const timeline = new AudioTimeline();
    // At performance time 5000ms the audio clock read 2s: audio is 3s behind.
    timeline.sync(5000, 2);
    expect(timeline.toAudioTime(5000)).toBeCloseTo(2);
    expect(timeline.toAudioTime(5250)).toBeCloseTo(2.25);
    expect(timeline.toAudioTime(4750)).toBeCloseTo(1.75);
  });

  it('falls back to the last sync for devices that stamp everything 0', () => {
    const timeline = new AudioTimeline();
    timeline.sync(5000, 2);
    expect(timeline.toAudioTime(0)).toBeCloseTo(2);
    expect(timeline.toAudioTime(undefined)).toBeCloseTo(2);
  });

  it('reports 0 until it has ever been synced', () => {
    expect(new AudioTimeline().toAudioTime(1234)).toBe(0);
  });

  it('smooths small offset jitter instead of chasing every sample', () => {
    const timeline = new AudioTimeline({ smoothing: 0.25 });
    timeline.sync(1000, 1); // offset 0
    timeline.sync(1000, 1.004); // sample says offset +4ms
    // A quarter of the way there, so the mapping barely moves.
    expect(timeline.toAudioTime(1000)).toBeCloseTo(1.001);
  });

  it('snaps when the offset jumps, e.g. the audio context was suspended', () => {
    const timeline = new AudioTimeline({ smoothing: 0.25, snapThreshold: 0.05 });
    timeline.sync(1000, 1);
    timeline.sync(1000, 9);
    expect(timeline.toAudioTime(1000)).toBeCloseTo(9);
  });

  it('never lets smoothing run an event past the moment it was observed', () => {
    const timeline = new AudioTimeline({ smoothing: 0.25 });
    timeline.sync(1000, 1);
    timeline.sync(1000, 0.996); // offset drifted earlier
    // Smoothing alone would place a message at 1000ms after "now" (0.996).
    expect(timeline.toAudioTime(1000)).toBeLessThanOrEqual(0.996);
  });
});

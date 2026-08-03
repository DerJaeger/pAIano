export interface AudioTimelineOptions {
  /** How much of each new sample to believe, 0–1. Lower is steadier. */
  smoothing?: number;
  /** Offset jump (seconds) beyond which we stop smoothing and jump. */
  snapThreshold?: number;
}

const DEFAULT_SMOOTHING = 0.2;
const DEFAULT_SNAP_THRESHOLD = 0.05;

/**
 * Maps Web MIDI timestamps (`performance.now()` domain, milliseconds) onto the
 * audio clock (`AudioContext` seconds), which is the master clock for
 * everything else — see ADR-0002.
 *
 * The caller feeds in correlated (performance, audio) pairs sampled from the
 * audio context. Those samples jitter by a millisecond or two, so the offset is
 * smoothed; a large jump (the context was suspended and resumed) snaps instead,
 * because smoothing across it would mistime every note for seconds.
 */
export class AudioTimeline {
  private readonly smoothing: number;
  private readonly snapThreshold: number;
  private offset: number | undefined;
  private lastPerformanceMs = 0;
  private lastAudioTime = 0;

  constructor(options: AudioTimelineOptions = {}) {
    this.smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    this.snapThreshold = options.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
  }

  /** Records that `performanceMs` and `audioTime` name the same instant. */
  sync(performanceMs: number, audioTime: number): void {
    const sampled = audioTime - performanceMs / 1000;
    if (this.offset === undefined || Math.abs(sampled - this.offset) > this.snapThreshold) {
      this.offset = sampled;
    } else {
      this.offset += (sampled - this.offset) * this.smoothing;
    }
    this.lastPerformanceMs = performanceMs;
    this.lastAudioTime = audioTime;
  }

  /**
   * A timestamp of 0 or `undefined` — which some drivers send for every message
   * — means "just now", so it maps to the most recent sample.
   */
  toAudioTime(performanceMs: number | undefined): number {
    if (this.offset === undefined) return 0;
    if (performanceMs === undefined || performanceMs <= 0) return this.lastAudioTime;

    const audioTime = performanceMs / 1000 + this.offset;
    // A message already observed cannot be in the future, whatever smoothing says.
    return performanceMs <= this.lastPerformanceMs
      ? Math.min(audioTime, this.lastAudioTime)
      : audioTime;
  }
}

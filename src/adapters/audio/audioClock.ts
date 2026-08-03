/** A correlated reading of the wall clock and the audio clock. */
export interface ClockSample {
  /** `performance.now()` domain, milliseconds. */
  performanceTime: number;
  /** `AudioContext.currentTime` domain, seconds. */
  audioTime: number;
}

export interface AudioClock {
  readonly context: AudioContext;
  sample(): ClockSample;
}

/**
 * The bridge between input timestamps and the audio clock, which is the master
 * clock for scheduling (ADR-0002). Create it from a user gesture: browsers
 * start an `AudioContext` suspended otherwise.
 */
export function createAudioClock(context: AudioContext = new AudioContext()): AudioClock {
  return {
    context,
    sample(): ClockSample {
      const timestamp = context.getOutputTimestamp();
      // A context that has never rendered reports contextTime 0 and no
      // performanceTime; sampling both clocks back-to-back is close enough.
      if (timestamp.contextTime && timestamp.performanceTime !== undefined) {
        return { performanceTime: timestamp.performanceTime, audioTime: timestamp.contextTime };
      }
      return { performanceTime: performance.now(), audioTime: context.currentTime };
    },
  };
}

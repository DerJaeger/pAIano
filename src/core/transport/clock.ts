/**
 * The app's master clock (ADR-0004).
 *
 * Everything with a time on it — MIDI input timestamps, scheduled output, the
 * transport's position — is milliseconds in the `performance.now()` domain.
 * That is the domain the browser hands us input events in and the domain
 * `MIDIOutput.send()` schedules in, so there is exactly one conversion in the
 * app: none.
 */
export interface Clock {
  /** Milliseconds since the page's time origin. Monotonic. */
  now(): number;
}

/** The real clock. Monotonic and immune to the wall clock being adjusted. */
export const performanceClock: Clock = {
  now: () => performance.now(),
};

/**
 * A clock the test steps by hand, so scheduling is deterministic: no timers, no
 * waiting, no flake. Time only ever moves forward.
 */
export class FakeClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  /** Moves time forward by `ms`. */
  advance(ms: number): void {
    if (ms < 0) throw new Error(`cannot advance by ${String(ms)}ms: time only moves forward`);
    this.current += ms;
  }

  /** Moves time forward to an absolute instant. */
  advanceTo(ms: number): void {
    this.advance(ms - this.current);
  }
}

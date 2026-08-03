import type { TempoMap } from '../score/types';

/** A bar range to repeat, in ticks on the expanded timeline. */
export interface LoopRange {
  startTick: number;
  /** Exclusive: playback jumps back the instant it reaches this tick. */
  endTick: number;
}

export interface TimelineParams {
  /** Where playback begins on the expanded timeline. */
  fromTick: number;
  /** The clock reading `fromTick` sounds at, in milliseconds. */
  startTime: number;
  /** End of the score. Ignored when looping. */
  endTick: number;
  /** 1 is the written tempo; 0.5 is half speed. */
  speed: number;
  loop?: LoopRange | undefined;
  /** Whether a `fromTick` outside the loop is pulled onto the loop start. */
  clampToLoop?: boolean | undefined;
}

/**
 * Where playback actually begins, given a loop: pressing play outside the
 * looped range jumps into it rather than playing a stretch the loop will never
 * revisit.
 */
export function loopAdjustedStart(fromTick: number, loop: LoopRange | undefined): number {
  if (loop === undefined) return fromTick;
  return fromTick < loop.startTick || fromTick >= loop.endTick ? loop.startTick : fromTick;
}

/** One uninterrupted forward run through the tick timeline. */
export interface Lap {
  /** 0 is the first run; 1 is the first time round the loop. */
  index: number;
  startTick: number;
  /** Exclusive. */
  endTick: number;
  startTime: number;
  endTime: number;
}

/**
 * The map between score ticks and the clock, for one uninterrupted stretch of
 * playing.
 *
 * A loop makes tick ↔ time a one-to-many relation, so the mapping is expressed
 * as a sequence of *laps*: within a lap ticks advance monotonically, and the
 * lap index says which time round you mean. That keeps the cursor, the
 * scheduler and the loop boundary all reading from one structure.
 *
 * A timeline is immutable. Seeking, changing speed or moving the loop makes a
 * new one anchored at the current position, which is why nothing here has to
 * reason about a tempo change arriving mid-flight.
 */
export class PlaybackTimeline {
  readonly params: TimelineParams;
  private readonly tempoMap: TempoMap;
  /** Laps are generated forward on demand; a loop has no last lap. */
  private readonly laps: Lap[] = [];

  constructor(tempoMap: TempoMap, params: TimelineParams) {
    if (params.speed <= 0) throw new Error(`speed must be positive, got ${String(params.speed)}`);
    this.tempoMap = tempoMap;
    this.params = params;

    const loop = params.loop;
    const startTick =
      params.clampToLoop === true ? loopAdjustedStart(params.fromTick, loop) : params.fromTick;
    const endTick = loop === undefined ? params.endTick : loop.endTick;
    this.laps.push(this.makeLap(0, startTick, endTick, params.startTime));
  }

  /** When playing stops, or `Infinity` while looping. */
  get endTime(): number {
    return this.params.loop === undefined ? this.laps[0]!.endTime : Number.POSITIVE_INFINITY;
  }

  /** The lap with the given index, generating loop laps as needed. */
  lap(index: number): Lap | undefined {
    if (index < 0) return undefined;
    const loop = this.params.loop;
    if (loop === undefined) return index === 0 ? this.laps[0] : undefined;

    while (this.laps.length <= index) {
      const previous = this.laps[this.laps.length - 1]!;
      this.laps.push(
        this.makeLap(previous.index + 1, loop.startTick, loop.endTick, previous.endTime),
      );
    }
    return this.laps[index];
  }

  /** Which lap is playing at `time`, or `undefined` before the start / after the end. */
  lapAt(time: number): Lap | undefined {
    if (time < this.params.startTime) return undefined;
    for (let index = 0; ; index++) {
      const lap = this.lap(index);
      if (lap === undefined) return undefined;
      if (time < lap.endTime) return lap;
      // A zero-length loop would spin here forever; the constructor's callers
      // guarantee endTick > startTick, and a lap always spans some time.
      if (lap.endTime <= lap.startTime) return undefined;
    }
  }

  /** The tick sounding at `time`, or `undefined` outside the playing range. */
  tickAt(time: number): number | undefined {
    const lap = this.lapAt(time);
    if (lap === undefined) return undefined;
    const elapsedSeconds = ((time - lap.startTime) / 1000) * this.params.speed;
    return this.tempoMap.secondsToTick(this.tempoMap.tickToSeconds(lap.startTick) + elapsedSeconds);
  }

  /** When `tick` sounds on a given lap. Extrapolates past the lap's end. */
  timeOf(tick: number, lapIndex: number): number {
    const lap = this.lap(lapIndex);
    if (lap === undefined) throw new Error(`no lap ${String(lapIndex)}`);
    return lap.startTime + this.spanMs(lap.startTick, tick);
  }

  private makeLap(index: number, startTick: number, endTick: number, startTime: number): Lap {
    return {
      index,
      startTick,
      endTick,
      startTime,
      endTime: startTime + this.spanMs(startTick, endTick),
    };
  }

  /** Milliseconds of clock between two ticks, at the current speed. */
  private spanMs(fromTick: number, toTick: number): number {
    const seconds = this.tempoMap.tickToSeconds(toTick) - this.tempoMap.tickToSeconds(fromTick);
    return (seconds * 1000) / this.params.speed;
  }
}

import type { MidiOutputPort } from '../midi/output';
import type { Unsubscribe } from '../midi/types';
import { ALL_TRACKS, audibleTracks, type TrackSelection } from '../score/tracks';
import type { NoteEvent, Score } from '../score/types';
import type { Clock } from './clock';
import { loopAdjustedStart, PlaybackTimeline, type Lap, type LoopRange } from './timeline';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface TransportOptions {
  score: Score;
  output: MidiOutputPort;
  clock: Clock;
  /**
   * How far ahead notes are handed to the MIDI stack. Long enough that a
   * stuttering ticker cannot make us late, short enough that pausing feels
   * immediate — the queue is dropped on pause anyway.
   */
  lookaheadMs?: number;
  /** Velocity for guide notes; the score model carries no dynamics yet. */
  velocity?: number;
  /** Channel the guide plays on, 0-based. */
  channel?: number;
  /** GM percussion by default, so the count-in is a woodblock not a piano note. */
  clickChannel?: number;
  countInBeats?: number;
  speed?: number;
  /** Whether the guide starts audible. Persisted by the UI across sessions. */
  guideAudible?: boolean;
}

const DEFAULTS = {
  lookaheadMs: 150,
  velocity: 80,
  channel: 0,
  clickChannel: 9,
  countInBeats: 0,
  speed: 1,
  guideAudible: true,
};

/** GM: 76 is a high wood block, 77 the low one. */
const CLICK_ACCENT_NOTE = 76;
const CLICK_NOTE = 77;
const CLICK_ACCENT_VELOCITY = 110;
const CLICK_VELOCITY = 80;
const CLICK_LENGTH_MS = 40;

/** Where the scheduler has got to: an event, on a lap. */
interface Cursor {
  lapIndex: number;
  eventIndex: number;
}

/**
 * Play/pause/stop/seek, tempo scaling, bar looping and count-in, driving the
 * guide track out to a MIDI instrument.
 *
 * Two things keep this tractable. Notes are handed to the output *ahead* of
 * time with an absolute timestamp, so the browser's MIDI stack does the precise
 * timing and a coarse, jittery ticker is good enough to drive it. And the tick ↔
 * clock mapping lives in an immutable `PlaybackTimeline`: seeking, changing
 * speed or muting a hand throws the queue away and anchors a fresh timeline at
 * the current position, so no method here has to unpick a schedule in flight.
 *
 * Pure: the only time source is the injected `Clock`, and the only output is
 * the port. Tests drive it with a `FakeClock` and assert exact scheduled pairs.
 */
export class Transport {
  private readonly score: Score;
  private readonly output: MidiOutputPort;
  private readonly clock: Clock;
  private readonly lookaheadMs: number;
  private readonly velocity: number;
  private readonly channel: number;
  private readonly clickChannel: number;
  private readonly listeners = new Set<() => void>();

  private countInBeats: number;
  private speed: number;
  /** Whether the guide is sent out at all — practise silently, or listen along. */
  private guideAudible: boolean;
  private state: TransportState = 'stopped';
  private loop: LoopRange | undefined;
  private selection: TrackSelection = ALL_TRACKS;
  /** `score.events` filtered to audible tracks; kept sorted by `startTick`. */
  private events: readonly NoteEvent[];
  private timeline: PlaybackTimeline | undefined;
  private cursor: Cursor = { lapIndex: 0, eventIndex: 0 };
  /** Authoritative whenever the timeline is not: paused, stopped, counting in. */
  private positionTick = 0;
  private closed = false;

  constructor(options: TransportOptions) {
    this.score = options.score;
    this.output = options.output;
    this.clock = options.clock;
    this.lookaheadMs = options.lookaheadMs ?? DEFAULTS.lookaheadMs;
    this.velocity = options.velocity ?? DEFAULTS.velocity;
    this.channel = options.channel ?? DEFAULTS.channel;
    this.clickChannel = options.clickChannel ?? DEFAULTS.clickChannel;
    this.countInBeats = options.countInBeats ?? DEFAULTS.countInBeats;
    this.speed = options.speed ?? DEFAULTS.speed;
    this.guideAudible = options.guideAudible ?? DEFAULTS.guideAudible;
    this.events = this.score.events;
  }

  // --- Reading the transport ------------------------------------------------

  getState(): TransportState {
    return this.state;
  }

  getSpeed(): number {
    return this.speed;
  }

  getLoop(): LoopRange | undefined {
    return this.loop;
  }

  getSelection(): TrackSelection {
    return this.selection;
  }

  isGuideAudible(): boolean {
    return this.guideAudible;
  }

  /** Where playback is right now, on the repeat-expanded timeline. */
  getPositionTick(): number {
    if (this.state !== 'playing' || !this.timeline) return this.positionTick;

    const now = this.clock.now();
    const tick = this.timeline.tickAt(now);
    if (tick !== undefined) return tick;
    // Before the timeline starts we are still counting in; after it ends the
    // next `tick()` will stop us, but the cursor should already read the end.
    return now < this.timeline.params.startTime ? this.positionTick : this.score.durationTicks;
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Driving it -----------------------------------------------------------

  play(): void {
    if (this.closed || this.state === 'playing') return;

    const fresh = this.state === 'stopped';
    // Playing again after the piece finished means playing it again, not
    // pressing play on a transport already parked at the end.
    if (fresh && this.positionTick >= this.score.durationTicks) this.positionTick = 0;

    const now = this.clock.now();
    const startTick = loopAdjustedStart(this.positionTick, this.loop);
    // Counting in on every resume from pause would be maddening.
    const countInMs = fresh ? this.countInBeats * this.beatMs(startTick) : 0;

    this.state = 'playing';
    this.anchor(startTick, now + countInMs);
    if (countInMs > 0) this.emitCountIn(now, this.beatMs(startTick));
    this.notify();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.positionTick = this.getPositionTick();
    this.release();
    this.state = 'paused';
    this.notify();
  }

  stop(): void {
    this.release();
    this.state = 'stopped';
    this.positionTick = 0;
    this.notify();
  }

  /** Moves to a tick on the expanded timeline, clamped to the score. */
  seekTick(tick: number): void {
    const clamped = Math.min(Math.max(tick, 0), this.score.durationTicks);
    if (this.state === 'playing') this.anchor(clamped, this.clock.now());
    else {
      this.release();
      this.positionTick = clamped;
    }
    this.notify();
  }

  /** Moves to the first pass through a written measure. */
  seekMeasure(measureIndex: number): void {
    const step = this.score.playbackOrder.find(
      (candidate) => candidate.measureIndex === measureIndex,
    );
    if (step) this.seekTick(step.startTick);
  }

  /** 1 is the written tempo, 0.5 half speed. Takes effect without a jump. */
  setSpeed(speed: number): void {
    if (speed <= 0) throw new Error(`speed must be positive, got ${String(speed)}`);
    if (speed === this.speed) return;
    this.reconfigure(() => {
      this.speed = speed;
    });
  }

  setLoop(loop: LoopRange | undefined): void {
    if (loop && loop.endTick <= loop.startTick) {
      throw new Error('a loop must end after it starts');
    }
    this.reconfigure(() => {
      this.loop = loop;
    });
  }

  /** Loops a written bar range, inclusive, using each bar's first pass. */
  setLoopMeasures(fromMeasure: number, toMeasure: number): void {
    const first = this.score.playbackOrder.find((step) => step.measureIndex === fromMeasure);
    const last = this.score.playbackOrder.find((step) => step.measureIndex === toMeasure);
    if (!first || !last) return;
    this.setLoop({ startTick: first.startTick, endTick: last.startTick + last.durationTicks });
  }

  /** Which tracks the guide plays — mute the hand you are practising. */
  setSelection(selection: TrackSelection): void {
    this.reconfigure(() => {
      this.selection = selection;
      this.events = audibleTracks(this.score.events, selection);
    });
  }

  /**
   * Whether the guide reaches the instrument: off is practice, on is listening
   * along. It gates the sends, not the connection — the device stays selected,
   * the clock keeps running and the cursor keeps moving, so flipping it is
   * instant and mid-piece rather than a trip to the device picker.
   *
   * Re-anchoring rather than just setting the flag is what makes it immediate in
   * both directions: it panics away notes already queued or sounding on the way
   * down, and re-sends the note under the playhead on the way up, exactly as
   * un-muting a hand does.
   */
  setGuideAudible(audible: boolean): void {
    if (audible === this.guideAudible) return;
    this.reconfigure(() => {
      this.guideAudible = audible;
    });
  }

  setCountInBeats(beats: number): void {
    this.countInBeats = Math.max(0, Math.floor(beats));
    this.notify();
  }

  /**
   * Fills the lookahead window. Call from a ticker roughly every 25ms; being
   * late is harmless as long as it happens within the lookahead.
   */
  tick(): void {
    if (this.closed || this.state !== 'playing' || !this.timeline) return;

    const now = this.clock.now();
    const horizon = now + this.lookaheadMs;

    for (;;) {
      const lap = this.timeline.lap(this.cursor.lapIndex);
      if (lap === undefined) break;

      const event = this.events[this.cursor.eventIndex];
      if (event === undefined || event.startTick >= lap.endTick) {
        const next = this.timeline.lap(this.cursor.lapIndex + 1);
        // Stopping at the horizon also stops an empty loop generating laps forever.
        if (next === undefined || next.startTime > horizon) break;
        this.cursor = {
          lapIndex: next.index,
          eventIndex: this.firstEventAtOrAfter(next.startTick),
        };
        continue;
      }

      const startTime = this.timeline.timeOf(event.startTick, lap.index);
      if (startTime > horizon) break;
      this.emit(event, startTime, lap);
      this.cursor.eventIndex++;
    }

    if (now >= this.timeline.endTime) this.finish();
  }

  /** Silences the instrument and stops responding. */
  close(): void {
    if (this.closed) return;
    this.release();
    this.state = 'stopped';
    this.closed = true;
    this.listeners.clear();
  }

  // --- Internals ------------------------------------------------------------

  /** Applies a change and, if playing, picks up seamlessly from where we are. */
  private reconfigure(change: () => void): void {
    const now = this.clock.now();
    const position = this.getPositionTick();
    change();
    if (this.state === 'playing') this.anchor(loopAdjustedStart(position, this.loop), now);
    else this.positionTick = position;
    this.notify();
  }

  /**
   * Throws the queue away and rebuilds the tick ↔ clock mapping from
   * `(tick, atTime)`. Everything that changes playback mid-flight goes through
   * here, which is why nothing else has to edit a schedule in place.
   */
  private anchor(tick: number, atTime: number): void {
    this.output.panic();
    this.timeline = new PlaybackTimeline(this.score.tempoMap, {
      fromTick: tick,
      startTime: atTime,
      endTick: this.score.durationTicks,
      speed: this.speed,
      loop: this.loop,
      clampToLoop: true,
    });

    const first = this.timeline.lap(0)!;
    this.positionTick = first.startTick;
    this.cursor = { lapIndex: 0, eventIndex: this.firstEventAtOrAfter(first.startTick) };
    this.resumeSustaining(first);
  }

  /**
   * Re-sends notes that were already sounding when we re-anchored. The panic
   * above silenced them, and they start before the cursor so the scheduler will
   * never reach them — without this, muting a hand or nudging the tempo would
   * cut the other hand off mid-phrase.
   */
  private resumeSustaining(lap: Lap): void {
    for (const event of this.events) {
      if (event.startTick >= lap.startTick) break;
      if (event.startTick + event.durationTicks <= lap.startTick) continue;
      this.emit(event, lap.startTime, lap);
    }
  }

  private emit(event: NoteEvent, startTime: number, lap: Lap): void {
    // The count-in is deliberately not gated here: it is a metronome, and it is
    // how you know when to come in on a part you are playing yourself.
    if (!this.guideAudible) return;

    const endTick = event.startTick + event.durationTicks;
    // A note may not ring across a loop jump — the music has moved on.
    const endTime = Math.min(this.timeline!.timeOf(endTick, lap.index), lap.endTime);
    if (endTime <= startTime) return;

    this.output.send({
      midiNote: event.midiNote,
      velocity: this.velocity,
      startTime,
      endTime,
      channel: this.channel,
    });
  }

  private emitCountIn(from: number, beatMs: number): void {
    for (let beat = 0; beat < this.countInBeats; beat++) {
      const startTime = from + beat * beatMs;
      const accent = beat === 0;
      this.output.send({
        midiNote: accent ? CLICK_ACCENT_NOTE : CLICK_NOTE,
        velocity: accent ? CLICK_ACCENT_VELOCITY : CLICK_VELOCITY,
        startTime,
        endTime: startTime + CLICK_LENGTH_MS,
        channel: this.clickChannel,
      });
    }
  }

  private finish(): void {
    this.release();
    this.state = 'stopped';
    this.positionTick = this.score.durationTicks;
    this.notify();
  }

  /** Drops the queue, silences the instrument, forgets the mapping. */
  private release(): void {
    this.output.panic();
    this.timeline = undefined;
  }

  /** A quarter-note beat in milliseconds of clock, at the current speed. */
  private beatMs(tick: number): number {
    return 60_000 / this.score.tempoMap.bpmAt(tick) / this.speed;
  }

  /** Binary search: the first event at or after `tick`. */
  private firstEventAtOrAfter(tick: number): number {
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.events[middle]!.startTick < tick) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

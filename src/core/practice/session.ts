import type { MidiInputEvent, MidiInputPort, Unsubscribe } from '../midi/types';
import type { TrackSelection } from '../score/tracks';
import type { Score } from '../score/types';
import type { Transport, TransportState } from '../transport/transport';
import { expectedChords } from './expectations';
import { Matcher } from './matcher';
import { applyJudgements, EMPTY_STATS, type PracticeStats } from './stats';
import type { ExpectedChord, Judgement, PracticeMode } from './types';

export interface PracticeSessionOptions {
  score: Score;
  transport: Transport;
  input: MidiInputPort;
  mode?: PracticeMode;
  /** On-time window either side of a note, in quarter notes. */
  toleranceQuarters?: number;
  /** How far either side a press still counts as that note, in quarter notes. */
  windowQuarters?: number;
}

const DEFAULTS = {
  /** Nothing is judged until you ask for it. */
  mode: 'listen' as PracticeMode,
  /**
   * Roughly a sixteenth either side at 4/4 — tight enough that "in time" means
   * something, loose enough that a human hand can hit it.
   */
  toleranceQuarters: 0.3,
  windowQuarters: 1,
};

/** How many judgements the UI can look back over. */
const RECENT_LIMIT = 32;

/**
 * A practice run: the transport, your keyboard and the matcher, wired together
 * and given a mode.
 *
 * Still pure core — the transport is injected, the keyboard is a port, and the
 * only clock reading comes through `Transport.getPositionTick()`. A test drives
 * this with a `FakeClock`, a `FakeMidiInput` and a `RecordingMidiOutput` and
 * gets exactly reproducible verdicts.
 *
 * The one piece of cunning is how **Follow You** waits. Rather than teaching
 * the transport a fourth state, the session pauses it and seeks back to the
 * chord's own tick, so the music parks precisely on the beat it is waiting for
 * instead of wherever the 25ms ticker happened to notice. Playing the chord
 * resumes it; pressing play yourself gives up on that chord and moves on, which
 * is how you skip a note you cannot get.
 */
export class PracticeSession {
  private readonly score: Score;
  private readonly transport: Transport;
  private readonly toleranceTicks: number;
  private readonly windowTicks: number;
  private readonly subscriptions: Unsubscribe[] = [];
  private readonly listeners = new Set<() => void>();

  private mode: PracticeMode;
  private matcher: Matcher;
  private selection: TrackSelection;
  private stats: PracticeStats = EMPTY_STATS;
  /** The last few judgements, newest first, for the running feedback. */
  private recent: Judgement[] = [];
  /** Verdict per expected note, so the sheet can be coloured. */
  private results = new Map<number, Judgement>();
  private waiting = false;
  /** True while we are the ones driving the transport, so we ignore the echo. */
  private selfDriven = false;
  private lastPosition = 0;
  private lastState: TransportState;
  private closed = false;

  constructor(options: PracticeSessionOptions) {
    this.score = options.score;
    this.transport = options.transport;
    this.mode = options.mode ?? DEFAULTS.mode;

    const perQuarter = this.score.ticksPerQuarter;
    this.toleranceTicks = (options.toleranceQuarters ?? DEFAULTS.toleranceQuarters) * perQuarter;
    this.windowTicks = (options.windowQuarters ?? DEFAULTS.windowQuarters) * perQuarter;

    this.selection = this.transport.getSelection();
    this.matcher = this.buildMatcher();
    this.lastState = this.transport.getState();
    this.lastPosition = this.transport.getPositionTick();

    this.subscriptions.push(
      options.input.onMessage((event) => {
        this.handleInput(event);
      }),
      this.transport.onChange(() => {
        this.handleTransportChange();
      }),
    );
  }

  // --- Reading the session --------------------------------------------------

  getMode(): PracticeMode {
    return this.mode;
  }

  getStats(): PracticeStats {
    return this.stats;
  }

  /** Newest first. */
  getRecent(): readonly Judgement[] {
    return this.recent;
  }

  /** Every note judged so far, keyed by its index in the expected stream. */
  getResults(): ReadonlyMap<number, Judgement> {
    return this.results;
  }

  /** True while Follow You is holding the music back. */
  isWaiting(): boolean {
    return this.waiting;
  }

  /** The chord the music is waiting on, or the next one owed. */
  getPending(): ExpectedChord | undefined {
    return this.matcher.pending();
  }

  /** The notes of that chord you have not played yet. */
  getOwed(): readonly number[] {
    return this.matcher.owed();
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Driving it -----------------------------------------------------------

  setMode(mode: PracticeMode): void {
    if (mode === this.mode || this.closed) return;
    this.mode = mode;
    // Switching mode mid-piece starts a fresh judgement of it, aimed at where
    // the music actually is — not at a flood of misses from the bars behind.
    this.startRun();
    this.matcher.moveTo(this.transport.getPositionTick());
    if (this.waiting) this.release();
    this.notify();
  }

  /** Throws away the score so far without touching playback. */
  reset(): void {
    this.startRun();
    this.matcher.moveTo(this.transport.getPositionTick());
    this.notify();
  }

  /**
   * Advances the engine. Call from the same ticker that drives the transport;
   * being a few milliseconds late only shifts the gate by less than a note.
   */
  tick(): void {
    if (this.closed) return;

    const position = this.transport.getPositionTick();
    if (this.jumped(position)) {
      this.matcher.moveTo(position);
      this.forgetResultsFrom(position);
      if (this.waiting) this.waiting = false;
      this.notify();
    }
    this.lastPosition = position;

    if (this.mode === 'listen' || this.transport.getState() !== 'playing') return;

    this.record(this.matcher.advanceTo(position));
    if (this.mode === 'followYou') this.gate(position);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
    this.listeners.clear();
  }

  // --- Internals ------------------------------------------------------------

  private handleInput(event: MidiInputEvent): void {
    if (this.closed || this.mode === 'listen' || event.type !== 'noteOn') return;

    // Judging only happens during a run: a stopped transport means you are
    // trying the keyboard out, not practising. A wait is the exception — that
    // is a pause we asked for, and playing on is exactly what should end it.
    const state = this.transport.getState();
    if (state === 'stopped' || (state === 'paused' && !this.waiting)) return;

    const position = this.transport.getPositionTick();
    this.record([this.matcher.press(event.midiNote, position)]);

    if (this.waiting && (this.matcher.pending()?.startTick ?? Infinity) > position) {
      this.release();
    }
    this.notify();
  }

  private handleTransportChange(): void {
    if (this.closed) return;
    const state = this.transport.getState();

    if (this.transport.getSelection() !== this.selection) {
      // A different hand to play is a different piece to be judged on.
      this.selection = this.transport.getSelection();
      this.matcher = this.buildMatcher();
      this.startRun();
      this.waiting = false;
    } else if (state === 'playing' && this.lastState === 'stopped') {
      this.startRun();
    }

    // Reaching the end closes the run out: the last notes' windows extend past
    // the final barline, and without this they would never get a verdict.
    if (
      state === 'stopped' &&
      this.lastState === 'playing' &&
      this.mode !== 'listen' &&
      this.transport.getPositionTick() >= this.score.durationTicks
    ) {
      this.record(this.matcher.advanceTo(this.score.durationTicks + this.windowTicks + 1));
    }

    if (this.waiting && !this.selfDriven && state !== 'paused') {
      // Pressing play rather than the note is how you give up on a chord.
      if (state === 'playing') this.record(this.matcher.skipPending(this.lastPosition));
      this.waiting = false;
    }

    this.lastState = state;
    this.notify();
  }

  /** Holds the music on a chord until it has been played. */
  private gate(position: number): void {
    if (this.waiting) return;
    const pending = this.matcher.pending();
    if (pending === undefined || position < pending.startTick) return;

    this.waiting = true;
    this.drive(() => {
      this.transport.pause();
      // Park on the beat itself, not on wherever the ticker caught it.
      this.transport.seekTick(pending.startTick);
    });
    this.lastPosition = this.transport.getPositionTick();
    this.notify();
  }

  private release(): void {
    this.waiting = false;
    this.drive(() => {
      this.transport.play();
    });
    this.lastPosition = this.transport.getPositionTick();
  }

  /** Marks transport calls as ours, so the change handler ignores the echo. */
  private drive(change: () => void): void {
    this.selfDriven = true;
    try {
      change();
    } finally {
      this.selfDriven = false;
    }
  }

  private record(judgements: readonly Judgement[]): void {
    if (judgements.length === 0) return;
    this.stats = applyJudgements(this.stats, judgements);
    this.recent = [...judgements].reverse().concat(this.recent).slice(0, RECENT_LIMIT);
    for (const judgement of judgements) {
      if (judgement.note) this.results.set(judgement.note.index, judgement);
    }
    // A note missed while the ticker runs is feedback too, not just a press.
    this.notify();
  }

  private startRun(): void {
    this.stats = EMPTY_STATS;
    this.recent = [];
    this.results = new Map();
    this.matcher.reset();
  }

  /**
   * Whether the playhead moved by more than playing could account for — a seek,
   * a loop jump or a stop.
   *
   * Backwards is unambiguous: playing only ever goes forwards, and the two
   * moves we make ourselves both re-baseline `lastPosition` straight after.
   * Forwards needs a threshold, and a whole note-matching window is one a
   * ticker interval cannot cover at any speed the transport allows.
   */
  private jumped(position: number): boolean {
    return position < this.lastPosition - 1 || position > this.lastPosition + this.windowTicks;
  }

  private forgetResultsFrom(tick: number): void {
    for (const [index, judgement] of this.results) {
      if ((judgement.note?.startTick ?? 0) >= tick) this.results.delete(index);
    }
  }

  private buildMatcher(): Matcher {
    return new Matcher({
      chords: expectedChords(this.score, this.selection),
      toleranceTicks: this.toleranceTicks,
      windowTicks: this.windowTicks,
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

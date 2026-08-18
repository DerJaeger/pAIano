import type { MidiInputEvent } from '../midi/types';
import type { Command } from './types';

/**
 * Commands from the instrument itself, for when even the computer keyboard is
 * too far away — you have just fluffed a bar and want it again without lifting
 * your hands off the keys (Phase 6b).
 *
 * The design problem is that the sustain pedal is a pedal. Any vocabulary here
 * competes with playing the piano, so the recogniser is built to say nothing
 * far more often than it speaks:
 *
 * - **A single tap is never a command.** It is the most natural gesture and so
 *   the most dangerous one; ordinary pedalling is full of them.
 * - **A tap is short.** Holding the pedal, however briefly, is pedalling.
 * - **Taps must come in quick succession** to count as one gesture.
 * - **No note may be held**, at any point during the gesture. If you are
 *   playing, the pedal is pedalling.
 *
 * What is left — two or three deliberate quick taps with your hands off the
 * keys — is not something that happens while playing a piece.
 *
 * Pure: it is driven by the timestamped input stream and by `tick`, so tests
 * run it from `FakeMidiInput` with no timers.
 */

/** Longer than this and the pedal was held, not tapped. */
export const TAP_MAX_MS = 250;

/** A gesture ends when no further tap arrives within this long. */
export const CHAIN_GAP_MS = 400;

/** What each tap count means. One tap is deliberately absent. */
const GESTURES: Record<number, Command> = {
  2: 'restartBar',
  3: 'restartSong',
};

export class GestureRecognizer {
  private readonly emit: (command: Command) => void;

  private keysDown = 0;
  private sustainDownAt: number | undefined;
  /** Taps in the chain being built, or 0 when there is no chain. */
  private taps = 0;
  /** When the chain last saw a tap end. */
  private lastTapAt = 0;
  /** Set when something disqualified the chain; it stays dead until it lapses. */
  private spoiled = false;

  constructor(emit: (command: Command) => void) {
    this.emit = emit;
  }

  handle(event: MidiInputEvent): void {
    // Time only ever moves forward with the stream, so every event is also a
    // chance to notice that the previous chain has run out.
    this.expire(event.time);

    switch (event.type) {
      case 'noteOn':
        this.keysDown++;
        this.spoiled = true;
        return;

      case 'noteOff':
        this.keysDown = Math.max(0, this.keysDown - 1);
        return;

      case 'sustain':
        if (event.down) this.onPedalDown(event.time);
        else this.onPedalUp(event.time);
        return;
    }
  }

  /**
   * Lets a finished gesture fire. A chain cannot be recognised at its last tap
   * — a third tap may still be coming — so something has to notice the silence.
   * Call it from the same ticker that drives the transport.
   */
  tick(now: number): void {
    this.expire(now);
  }

  private onPedalDown(time: number): void {
    this.sustainDownAt = time;
    // A gesture must begin with your hands off the keys, and must stay that way.
    if (this.keysDown > 0) this.spoiled = true;
  }

  private onPedalUp(time: number): void {
    const downAt = this.sustainDownAt;
    this.sustainDownAt = undefined;
    if (downAt === undefined) return;

    if (time - downAt > TAP_MAX_MS) {
      // Held, not tapped: that was pedalling, and it spoils anything in flight.
      this.reset();
      this.spoiled = true;
      return;
    }

    // Each chain is judged on its own: a fresh one starts clean unless your
    // hands are on the keys right now. Without this, one ordinary pedal press
    // would deafen the recogniser to the next real gesture.
    if (this.taps === 0) this.spoiled = this.keysDown > 0;
    this.taps++;
    this.lastTapAt = time;
  }

  /** Fires the chain if it has gone quiet, and clears it either way. */
  private expire(now: number): void {
    if (this.taps === 0 || now - this.lastTapAt <= CHAIN_GAP_MS) return;

    const command = this.spoiled || this.keysDown > 0 ? undefined : GESTURES[this.taps];
    this.reset();
    if (command) this.emit(command);
  }

  private reset(): void {
    this.taps = 0;
    this.spoiled = false;
  }
}

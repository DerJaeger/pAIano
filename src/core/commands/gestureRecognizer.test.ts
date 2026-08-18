import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMidiInput } from '../midi/fakeMidiInput';
import type { Command } from './types';
import { GestureRecognizer, CHAIN_GAP_MS, TAP_MAX_MS } from './gestureRecognizer';

let input: FakeMidiInput;
let fired: Command[];
let recognizer: GestureRecognizer;

beforeEach(() => {
  input = new FakeMidiInput();
  fired = [];
  recognizer = new GestureRecognizer((command) => fired.push(command));
  input.onMessage((event) => {
    recognizer.handle(event);
  });
});

/** A pedal tap: down and straight back up, `heldMs` apart. */
function tap(heldMs = 60): void {
  input.pedal(true);
  input.advance(heldMs);
  input.pedal(false);
}

/** Lets the chain time out, which is when a gesture is finally recognised. */
function settle(): void {
  input.advance(CHAIN_GAP_MS + 1);
  recognizer.tick(input.now);
}

describe('the pedal gesture recognizer', () => {
  it('says nothing about a single tap', () => {
    // The pedal is a pedal first. One tap is how you use it, so it can never
    // be a command, however tempting a binding it would make.
    tap();
    settle();

    expect(fired).toEqual([]);
  });

  it('restarts the bar on a double tap', () => {
    tap();
    input.advance(100);
    tap();
    settle();

    expect(fired).toEqual(['restartBar']);
  });

  it('restarts the piece on a triple tap', () => {
    tap();
    input.advance(100);
    tap();
    input.advance(100);
    tap();
    settle();

    expect(fired).toEqual(['restartSong']);
  });

  it('ignores a fourth tap rather than guessing at it', () => {
    for (let count = 0; count < 4; count++) {
      tap();
      input.advance(100);
    }
    settle();

    expect(fired).toEqual([]);
  });

  it('does not fire until the chain has had time to end', () => {
    tap();
    input.advance(100);
    tap();
    recognizer.tick(input.now);

    // A third tap could still be coming, and firing early would make every
    // triple tap also perform a double.
    expect(fired).toEqual([]);
  });

  it('ignores a pedal held down like a pedal', () => {
    tap(TAP_MAX_MS + 50);
    input.advance(100);
    tap(TAP_MAX_MS + 50);
    settle();

    expect(fired).toEqual([]);
  });

  it('ignores taps too far apart to be one gesture', () => {
    tap();
    input.advance(CHAIN_GAP_MS + 50);
    recognizer.tick(input.now);
    tap();
    settle();

    expect(fired).toEqual([]);
  });

  it('never fires while a note is held', () => {
    // The guard that makes the whole idea safe: if you are playing, the pedal
    // is pedalling, not commanding.
    input.press(60);
    tap();
    input.advance(100);
    tap();
    settle();

    expect(fired).toEqual([]);
  });

  it('gives up a gesture the moment you start playing again', () => {
    tap();
    input.advance(100);
    input.press(60);
    tap();
    settle();

    expect(fired).toEqual([]);
  });

  it('works again once your hands come off the keys', () => {
    input.press(60);
    tap();
    settle();
    input.release(60);

    tap();
    input.advance(100);
    tap();
    settle();

    expect(fired).toEqual(['restartBar']);
  });

  it('does not count a long hold as one of the taps', () => {
    input.pedal(true);
    input.advance(1000);
    input.pedal(false);
    input.advance(100);
    tap();
    settle();

    // A hold and a tap is not a double tap; only the tap counted, and one tap
    // is never a command.
    expect(fired).toEqual([]);
  });

  it('still hears a gesture after a stretch of ordinary pedalling', () => {
    // Each chain is judged on its own. Pedalling through a phrase must not
    // leave the recogniser deaf to the gesture that follows it.
    input.pedal(true);
    input.advance(1200);
    input.pedal(false);
    input.advance(500);

    tap();
    input.advance(100);
    tap();
    settle();

    expect(fired).toEqual(['restartBar']);
  });
});

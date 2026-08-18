import { useEffect, useRef } from 'react';
import { commandForKey, DEFAULT_BINDINGS, type Bindings } from '../core/commands/bindings';
import { GestureRecognizer } from '../core/commands/gestureRecognizer';
import { runCommand } from '../core/commands/commands';
import type { CommandContext } from '../core/commands/types';
import type { MidiInputPort } from '../core/midi/types';

/** How often the gesture recogniser is given a chance to notice a chain ended. */
const GESTURE_TICK_MS = 50;

/**
 * Both input surfaces, wired to the one command layer (Phase 6b): the computer
 * keyboard, and pedal gestures on the instrument.
 *
 * The context is held in a ref rather than in the dependency list because it is
 * rebuilt on every render — rebinding a `keydown` listener that often would be
 * wasteful, and worse, would drop a gesture chain mid-build every time.
 *
 * `enabled` turns both surfaces off for anything that owns the keyboard while it
 * is open — today the cheat sheet, where a key press means "bind this", and in
 * Phase 6a the fuzzy finder, where it means "search for this".
 */
export function useCommands(
  context: CommandContext | undefined,
  input: MidiInputPort | undefined,
  bindings: Bindings = DEFAULT_BINDINGS,
  enabled = true,
): void {
  const latest = useRef(context);
  latest.current = context;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      // A shortcut fired while you are typing into a field is a bug, not a
      // convenience.
      if (event.isComposing || isTyping(event.target)) return;

      // Only a chord that is actually bound is taken, so an unbound ctrl or
      // meta combination still reaches the browser untouched.
      const command = commandForKey(event, bindings);
      if (!command || !latest.current) return;

      // Only once we know the key is ours: space scrolls the page otherwise,
      // and the arrows move the caret.
      event.preventDefault();
      runCommand(command, latest.current);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [bindings, enabled]);

  useEffect(() => {
    if (!input || !enabled) return;

    const recognizer = new GestureRecognizer((command) => {
      if (latest.current) runCommand(command, latest.current);
    });
    const unsubscribe = input.onMessage((event) => {
      recognizer.handle(event);
    });
    // A gesture is recognised by the silence after it, so something has to keep
    // asking; the stream alone would leave the last chain hanging.
    const ticker = setInterval(() => {
      recognizer.tick(performance.now());
    }, GESTURE_TICK_MS);

    return () => {
      unsubscribe();
      clearInterval(ticker);
    };
  }, [input, enabled]);
}

/** Whether the player is typing, in which case the keys are theirs, not ours. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

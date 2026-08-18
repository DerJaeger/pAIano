import type { Command } from './types';

/**
 * Computer-keyboard bindings for the command layer.
 *
 * Pure and DOM-free: a chord is a string, and a `KeyEvent` is the handful of
 * fields a real `KeyboardEvent` shares with the object a test writes by hand.
 */
export interface KeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Chord → command. Several chords may point at the same command. */
export type Bindings = Readonly<Record<string, Command>>;

/** Keys whose `event.key` is a character we would rather name than print. */
const NAMED_KEYS: Record<string, string> = {
  ' ': 'space',
};

/**
 * A stable name for a key press: modifiers in a fixed order, lower-cased.
 *
 * Lower-casing means an upper-case letter arrives as `shift+r` whether it came
 * from holding shift or from caps lock being on, so a binding cannot be
 * unreachable because of a lock key nobody remembers pressing.
 */
export function chordOf(event: KeyEvent): string {
  const named = NAMED_KEYS[event.key];
  if (named !== undefined) return named;

  const key = event.key.toLowerCase();
  const shift = event.shiftKey || (event.key.length === 1 && event.key !== key);
  return [
    event.metaKey ? 'meta' : '',
    event.ctrlKey ? 'ctrl' : '',
    event.altKey ? 'alt' : '',
    shift ? 'shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

/**
 * What the app answers to out of the box.
 *
 * Single unmodified keys throughout: your hands are on the piano, and a chord
 * that needs two fingers on the computer keyboard defeats the point. Nothing
 * uses ctrl or meta, which belong to the browser and the OS.
 */
export const DEFAULT_BINDINGS: Bindings = {
  space: 'playPause',
  escape: 'stop',
  arrowleft: 'previousBar',
  arrowright: 'nextBar',
  r: 'restartBar',
  'shift+r': 'restartSong',
  l: 'repeatBar',
  arrowdown: 'tempoDown',
  arrowup: 'tempoUp',
  g: 'toggleGuideOutput',
  h: 'cycleHands',
  f: 'findSong',
  b: 'toggleSidebar',
  'shift+/': 'showHelp',
  '?': 'showHelp',
};

export function commandForKey(event: KeyEvent, bindings: Bindings): Command | undefined {
  return bindings[chordOf(event)];
}

/** Every chord bound to a command, for the cheat sheet. */
export function keysFor(command: Command, bindings: Bindings): string[] {
  return Object.entries(bindings)
    .filter(([, bound]) => bound === command)
    .map(([chord]) => chord);
}

/**
 * `bindings` with `command` moved to `chord`.
 *
 * A move, not an addition: the command lets go of whatever chords it held
 * before, and the chord is taken from whatever command held it. Changing a key
 * should leave the old one free, and one chord cannot mean two things.
 *
 * The defaults may still give a command more than one chord — `?` and `shift+/`
 * are the same key on different layouts — but that is a default, not something
 * rebinding has to preserve.
 */
export function withBinding(bindings: Bindings, chord: string, command: Command): Bindings {
  const kept = Object.entries(bindings).filter(([, bound]) => bound !== command);
  return { ...Object.fromEntries(kept), [chord]: command };
}

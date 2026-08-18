import { describe, expect, it } from 'vitest';
import {
  chordOf,
  commandForKey,
  DEFAULT_BINDINGS,
  keysFor,
  withBinding,
  type KeyEvent,
} from './bindings';
import { COMMANDS } from './types';

function key(name: string, modifiers: Partial<KeyEvent> = {}): KeyEvent {
  return {
    key: name,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  };
}

describe('chordOf', () => {
  it('names a plain key by itself', () => {
    expect(chordOf(key('r'))).toBe('r');
  });

  it('is case-insensitive, so caps lock cannot break the bindings', () => {
    expect(chordOf(key('R'))).toBe('shift+r');
    expect(chordOf(key('R', { shiftKey: true }))).toBe('shift+r');
  });

  it('names modifiers in a fixed order', () => {
    expect(chordOf(key('b', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'ctrl+alt+shift+b',
    );
  });

  it('leaves named keys named', () => {
    expect(chordOf(key(' '))).toBe('space');
    expect(chordOf(key('ArrowLeft'))).toBe('arrowleft');
  });
});

describe('the default bindings', () => {
  it('binds every command to something', () => {
    const bound = new Set(Object.values(DEFAULT_BINDINGS));

    expect([...COMMANDS].filter((command) => !bound.has(command))).toEqual([]);
  });

  it('binds each chord to exactly one command', () => {
    const chords = Object.keys(DEFAULT_BINDINGS);

    expect(new Set(chords).size).toBe(chords.length);
  });

  it('leaves the browser its own shortcuts', () => {
    // Anything with ctrl or meta belongs to the browser or the OS, and taking
    // one hostage is a worse bug than the shortcut being unbound.
    expect(Object.keys(DEFAULT_BINDINGS).filter((chord) => /ctrl|meta/.test(chord))).toEqual([]);
  });

  it('puts play/pause on the space bar', () => {
    expect(commandForKey(key(' '), DEFAULT_BINDINGS)).toBe('playPause');
  });
});

describe('looking a command up', () => {
  it('finds nothing for an unbound key', () => {
    expect(commandForKey(key('q'), DEFAULT_BINDINGS)).toBeUndefined();
  });

  it('lists the keys a command answers to, for the cheat sheet', () => {
    expect(keysFor('playPause', DEFAULT_BINDINGS)).toContain('space');
  });
});

describe('rebinding', () => {
  it('moves a command to a new key', () => {
    const bindings = withBinding(DEFAULT_BINDINGS, 'j', 'nextBar');

    expect(commandForKey(key('j'), bindings)).toBe('nextBar');
  });

  it('frees the key the command used to be on', () => {
    const bindings = withBinding(DEFAULT_BINDINGS, 'j', 'nextBar');

    // Changing a shortcut has to leave the old key free, or the cheat sheet
    // ends up listing keys nobody chose.
    expect(keysFor('nextBar', bindings)).toEqual(['j']);
    expect(commandForKey(key('ArrowRight'), bindings)).toBeUndefined();
  });

  it('takes the chord off whatever held it before', () => {
    const bindings = withBinding(DEFAULT_BINDINGS, 'space', 'nextBar');

    expect(commandForKey(key(' '), bindings)).toBe('nextBar');
    expect(keysFor('playPause', bindings)).not.toContain('space');
  });

  it('leaves the defaults untouched', () => {
    withBinding(DEFAULT_BINDINGS, 'space', 'nextBar');

    expect(commandForKey(key(' '), DEFAULT_BINDINGS)).toBe('playPause');
  });
});

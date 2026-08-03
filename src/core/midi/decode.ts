import type { MidiInputEvent } from './types';

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const SUSTAIN_CC = 64;
/** Below this a pedal is considered released; the MIDI spec's own threshold. */
const PEDAL_ON = 64;

/**
 * Raw MIDI bytes → an event we care about, or `undefined` for the many messages
 * a keyboard sends that a practice trainer has no use for (aftertouch, pitch
 * bend, clock, active sensing).
 */
export function decodeMidiMessage(
  data: ArrayLike<number>,
  time: number,
): MidiInputEvent | undefined {
  const status = data[0];
  if (status === undefined || status < 0x80) return undefined;

  const channel = status & 0x0f;
  const midiNote = data[1];

  switch (status & 0xf0) {
    case NOTE_ON: {
      if (midiNote === undefined) return undefined;
      const velocity = data[2] ?? 0;
      // Keyboards using running status send note-on/velocity-0 for releases.
      return velocity > 0
        ? { type: 'noteOn', midiNote, velocity, channel, time }
        : { type: 'noteOff', midiNote, channel, time };
    }
    case NOTE_OFF: {
      if (midiNote === undefined) return undefined;
      return { type: 'noteOff', midiNote, channel, time };
    }
    case CONTROL_CHANGE: {
      if (midiNote !== SUSTAIN_CC) return undefined;
      return { type: 'sustain', down: (data[2] ?? 0) >= PEDAL_ON, channel, time };
    }
    default:
      return undefined;
  }
}

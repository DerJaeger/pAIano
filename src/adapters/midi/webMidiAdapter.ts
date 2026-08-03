import { MidiInputHub } from '../../core/midi/midiInputHub';
import type { ClockSample } from '../audio/audioClock';

export type MidiUnavailableReason = 'unsupported' | 'insecure-context' | 'denied' | 'failed';

/** Why we could not talk to any MIDI hardware, in terms the UI can explain. */
export class MidiUnavailableError extends Error {
  readonly reason: MidiUnavailableReason;

  constructor(reason: MidiUnavailableReason, message: string) {
    super(message);
    this.name = 'MidiUnavailableError';
    this.reason = reason;
  }
}

const MESSAGES: Record<MidiUnavailableReason, string> = {
  unsupported:
    'This browser has no Web MIDI support. Safari does not implement it — use Chrome, Edge, or Firefox 108+.',
  'insecure-context': 'Web MIDI needs a secure context. Open the app over https or on localhost.',
  denied: 'The browser blocked access to your MIDI devices. Allow MIDI for this site and retry.',
  failed: 'Could not start Web MIDI.',
};

/**
 * The only file in the app that knows `navigator.requestMIDIAccess` exists.
 * Everything else talks to `MidiInputPort`.
 */
export async function openWebMidi(sample: () => ClockSample): Promise<WebMidiInput> {
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
    throw unavailable('unsupported');
  }
  if (typeof isSecureContext === 'boolean' && !isSecureContext) {
    throw unavailable('insecure-context');
  }

  try {
    // No `sysex: true`: it asks the user for a scarier permission than we need.
    return new WebMidiInput(await navigator.requestMIDIAccess(), sample);
  } catch (cause) {
    const denied = cause instanceof DOMException && cause.name === 'SecurityError';
    throw unavailable(denied ? 'denied' : 'failed', cause);
  }
}

function unavailable(reason: MidiUnavailableReason, cause?: unknown): MidiUnavailableError {
  const detail = cause instanceof Error ? ` (${cause.message})` : '';
  return new MidiUnavailableError(reason, MESSAGES[reason] + detail);
}

class WebMidiInput extends MidiInputHub {
  private readonly access: MIDIAccess;
  private readonly sample: () => ClockSample;

  constructor(access: MIDIAccess, sample: () => ClockSample) {
    super();
    this.access = access;
    this.sample = sample;
    // Fires on every plug and unplug, which is all the hot-plug support we need.
    access.onstatechange = () => {
      this.refresh();
    };
    this.refresh();
  }

  override close(): void {
    this.access.onstatechange = null;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    super.close();
  }

  private refresh(): void {
    const inputs = [...this.access.inputs.values()].filter(
      (input) => input.state !== 'disconnected',
    );

    this.setDevices(
      inputs.map((input) => ({
        id: input.id,
        name: input.name ?? 'MIDI input',
        manufacturer: input.manufacturer ?? '',
      })),
    );

    // Listening to every input (rather than just the selected one) keeps
    // switching devices instant, and the hub filters by selection anyway.
    for (const input of inputs) {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const { performanceTime, audioTime } = this.sample();
        this.syncClock(performanceTime, audioTime);
        this.handleRawMessage(input.id, event.data, event.timeStamp);
      };
    }
  }
}

export type { WebMidiInput };

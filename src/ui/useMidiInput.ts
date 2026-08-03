import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { applyMidiEvent, silentKeyboard, type KeyboardState } from '../core/midi/keyboard';
import type { MidiDevice, MidiInputPort } from '../core/midi/types';
import { createAudioClock } from '../adapters/audio/audioClock';
import { openWebMidi } from '../adapters/midi/webMidiAdapter';

export type MidiStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type OpenMidi = () => Promise<MidiInputPort>;

/** Web MIDI for real, plus the audio clock its timestamps are mapped onto. */
export const openWebMidiInput: OpenMidi = () => {
  const clock = createAudioClock();
  return openWebMidi(() => clock.sample());
};

export interface MidiConnection {
  status: MidiStatus;
  error: string | undefined;
  port: MidiInputPort | undefined;
  connect: () => void;
}

/**
 * Opening MIDI is deliberately a user action: browsers prompt for permission,
 * and an `AudioContext` created outside a gesture starts suspended.
 */
export function useMidiInput(open: OpenMidi = openWebMidiInput): MidiConnection {
  const [status, setStatus] = useState<MidiStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [port, setPort] = useState<MidiInputPort | undefined>(undefined);

  const connect = useCallback(() => {
    setStatus('connecting');
    setError(undefined);
    open().then(
      (opened) => {
        setPort(opened);
        setStatus('ready');
      },
      (cause: unknown) => {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [open]);

  useEffect(() => () => port?.close(), [port]);

  return { status, error, port, connect };
}

const NO_DEVICES: readonly MidiDevice[] = [];

export function useMidiDevices(port: MidiInputPort | undefined): {
  devices: readonly MidiDevice[];
  selectedId: string | undefined;
} {
  const subscribe = useCallback(
    (onChange: () => void) => port?.onDevicesChanged(onChange) ?? (() => undefined),
    [port],
  );

  const devices = useSyncExternalStore(subscribe, () => port?.getDevices() ?? NO_DEVICES);
  const selectedId = useSyncExternalStore(subscribe, () => port?.getSelectedDeviceId());

  return { devices, selectedId };
}

/** Which keys are down right now, folded from the port's message stream. */
export function useKeyboardState(port: MidiInputPort | undefined): KeyboardState {
  const [state, setState] = useState<KeyboardState>(silentKeyboard);

  useEffect(() => {
    setState(silentKeyboard);
    if (!port) return;
    return port.onMessage((event) => {
      setState((previous) => applyMidiEvent(previous, event));
    });
  }, [port]);

  return state;
}

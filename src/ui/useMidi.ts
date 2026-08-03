import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { openWebMidi, type WebMidiPorts } from '../adapters/midi/webMidiAdapter';
import { applyMidiEvent, silentKeyboard, type KeyboardState } from '../core/midi/keyboard';
import type { MidiOutputPort } from '../core/midi/output';
import type { MidiDevice, MidiInputPort } from '../core/midi/types';

export type MidiStatus = 'idle' | 'connecting' | 'ready' | 'error';

/** The seam tests replace: one call yielding both directions of one device. */
export type OpenMidi = () => Promise<WebMidiPorts>;

export interface MidiConnection {
  status: MidiStatus;
  error: string | undefined;
  input: MidiInputPort | undefined;
  output: MidiOutputPort | undefined;
  connect: () => void;
}

/**
 * Opening MIDI is deliberately a user action: browsers prompt for permission
 * the first time, and doing it on load would be a prompt nobody asked for.
 */
export function useMidi(open: OpenMidi = openWebMidi): MidiConnection {
  const [status, setStatus] = useState<MidiStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [ports, setPorts] = useState<WebMidiPorts | undefined>(undefined);

  const connect = useCallback(() => {
    setStatus('connecting');
    setError(undefined);
    open().then(
      (opened) => {
        setPorts(opened);
        setStatus('ready');
      },
      (cause: unknown) => {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [open]);

  useEffect(() => () => ports?.close(), [ports]);

  return { status, error, input: ports?.input, output: ports?.output, connect };
}

const NO_DEVICES: readonly MidiDevice[] = [];

/** Works for either direction — both ports report devices the same way. */
export function useMidiDevices(port: MidiInputPort | MidiOutputPort | undefined): {
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

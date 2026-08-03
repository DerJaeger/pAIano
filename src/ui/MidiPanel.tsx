import { noteName } from './format';
import { PianoKeys } from './PianoKeys';
import { useKeyboardState, useMidiDevices, type MidiConnection } from './useMidi';

/**
 * Phase 2: pick a keyboard and see your playing land on screen. The connection
 * is owned by `App`, because Phase 4's guide track plays out of the same
 * device; the practice feedback (Phase 5) will read the same port again.
 */
export function MidiPanel({ connection }: { connection: MidiConnection }) {
  const { status, error, input: port, connect } = connection;
  const { devices, selectedId } = useMidiDevices(port);
  const keyboard = useKeyboardState(port);

  return (
    <section className="midi">
      <div className="midi-header">
        <h2>MIDI keyboard</h2>

        {status !== 'ready' && (
          <button className="button" onClick={connect} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Connecting…' : 'Connect a keyboard'}
          </button>
        )}

        {status === 'ready' &&
          (devices.length === 0 ? (
            <p className="muted">No MIDI devices found — plug your keyboard in.</p>
          ) : (
            <label className="device-picker">
              Device
              <select
                value={selectedId ?? ''}
                onChange={(event) => {
                  port?.select(event.target.value || undefined);
                }}
              >
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                    {device.manufacturer && ` — ${device.manufacturer}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>

      {status === 'error' && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {status === 'ready' && (
        <>
          <PianoKeys keysDown={keyboard.keysDown} sounding={keyboard.sounding} />
          <p className="muted keys-down">
            {keyboard.sounding.length === 0
              ? 'Play something.'
              : keyboard.sounding.map(noteName).join(' · ')}
            {keyboard.sustain && ' — sustain'}
          </p>
        </>
      )}
    </section>
  );
}

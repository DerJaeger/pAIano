import { pianoLayout } from './pianoLayout';
import { noteName } from './format';

const KEYS = pianoLayout();

/**
 * An 88-key strip showing what is under the player's hands: solid for keys
 * physically held, faded for notes the sustain pedal is holding on.
 */
export function PianoKeys({
  keysDown,
  sounding,
}: {
  keysDown: readonly number[];
  sounding: readonly number[];
}) {
  const down = new Set(keysDown);
  const ringing = new Set(sounding);

  return (
    <div
      className="piano"
      role="img"
      aria-label={
        sounding.length === 0 ? 'No keys down' : `Sounding: ${sounding.map(noteName).join(', ')}`
      }
    >
      {KEYS.map((key) => (
        <div
          key={key.midiNote}
          className={[
            'piano-key',
            key.black ? 'black' : 'white',
            down.has(key.midiNote) ? 'down' : ringing.has(key.midiNote) ? 'sustained' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: `${String(key.left)}%`, width: `${String(key.width)}%` }}
        />
      ))}
    </div>
  );
}

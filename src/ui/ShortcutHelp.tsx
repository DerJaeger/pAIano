import { useEffect, useState } from 'react';
import { chordOf, keysFor, withBinding, type Bindings } from '../core/commands/bindings';
import { COMMAND_LABELS, COMMANDS, type Command } from '../core/commands/types';

/** Keys worth drawing rather than spelling. */
const KEY_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
  escape: 'Esc',
};

/** How a chord is written on screen: `shift+r` reads better as `Shift + R`. */
function readable(chord: string): string {
  return chord
    .split('+')
    .map(
      (part) =>
        KEY_LABELS[part] ??
        (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)),
    )
    .join(' + ');
}

/**
 * The `?` cheat sheet, and the only place bindings can be changed.
 *
 * Rebinding lives here rather than in a settings screen because this is where
 * you look when you cannot remember a key, which is exactly the moment you want
 * to move it somewhere you will.
 */
export function ShortcutHelp({
  bindings,
  onRebind,
  onClose,
}: {
  bindings: Bindings;
  onRebind: (bindings: Bindings) => void;
  onClose: () => void;
}) {
  const [capturing, setCapturing] = useState<Command | undefined>(undefined);

  // Global shortcuts are switched off while this is open — a key press here
  // means "bind this" — so closing it is this component's own job.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (capturing !== undefined) return;
      if (event.key === 'Escape' || event.key === '?') onClose();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [capturing, onClose]);

  return (
    <div
      className="shortcut-help-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="shortcut-help"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2>Keyboard shortcuts</h2>
        <p className="muted">
          Your hands are on the piano, so these are all single keys. Two quick taps of the sustain
          pedal restart the bar and three restart the piece — but only with no note held down, so a
          gesture can never be mistaken for playing.
        </p>

        <table>
          <tbody>
            {COMMANDS.map((command) => (
              <tr key={command}>
                <th scope="row">{COMMAND_LABELS[command]}</th>
                <td>
                  <button
                    type="button"
                    className="chord"
                    aria-label={`Change the key for ${COMMAND_LABELS[command]}`}
                    onKeyDown={(event) => {
                      if (capturing !== command) return;
                      event.preventDefault();
                      if (event.key === 'Escape') {
                        setCapturing(undefined);
                        return;
                      }
                      onRebind(withBinding(bindings, chordOf(event), command));
                      setCapturing(undefined);
                    }}
                    onClick={() => {
                      setCapturing(command);
                    }}
                  >
                    {capturing === command
                      ? 'press a key…'
                      : keysFor(command, bindings).map(readable).join(' or ') || 'unbound'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

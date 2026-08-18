import type { MidiOutputPort } from '../core/midi/output';
import { tracksOf } from '../core/score/tracks';
import type { Score } from '../core/score/types';
import type { Transport } from '../core/transport/transport';
import { SPEEDS } from '../core/transport/speeds';
import { measureIndexAt } from '../core/notation/position';
import { useMidiDevices } from './useMidi';
import { useTransportState } from './useTransport';

const COUNT_IN_BEATS = 4;

/**
 * Phase 4's controls: play the piece on your own instrument, at your own speed,
 * round the bars you cannot get right, with the hand you are practising left
 * out. The cursor is driven from `App`, which owns the position.
 */
export function TransportPanel({
  score,
  transport,
  output,
  positionTick,
}: {
  score: Score;
  transport: Transport | undefined;
  output: MidiOutputPort | undefined;
  positionTick: number;
}) {
  const { state, speed, loop, selection, guideAudible } = useTransportState(transport);
  const { devices, selectedId } = useMidiDevices(output);
  const tracks = tracksOf(score);
  const measureIndex = measureIndexAt(score, positionTick) ?? score.measures.length - 1;
  const playing = state === 'playing';

  if (!transport) {
    return (
      <section className="transport">
        <p className="muted">
          Connect a MIDI instrument to play the guide track — it plays through your keyboard&rsquo;s
          own sounds.
        </p>
      </section>
    );
  }

  const toggle = (set: ReadonlySet<string> | undefined, id: string): Set<string> => {
    const next = new Set(set ?? []);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  return (
    <section className="transport">
      <div className="transport-row">
        <button
          type="button"
          className="button primary"
          onClick={() => {
            if (playing) transport.pause();
            else transport.play();
          }}
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            transport.stop();
          }}
          disabled={state === 'stopped' && positionTick === 0}
        >
          ■ Stop
        </button>

        <label className="speed">
          Speed
          <select
            value={speed}
            onChange={(event) => {
              transport.setSpeed(Number(event.target.value));
            }}
          >
            {SPEEDS.map((option) => (
              <option key={option} value={option}>
                {Math.round(option * 100)}%
              </option>
            ))}
          </select>
        </label>

        <label className="count-in">
          <input
            type="checkbox"
            onChange={(event) => {
              transport.setCountInBeats(event.target.checked ? COUNT_IN_BEATS : 0);
            }}
          />
          Count in
        </label>
      </div>

      <div className="transport-row">
        <button
          type="button"
          className="button"
          aria-pressed={loop !== undefined}
          onClick={() => {
            // One button, because looping the bar you are stuck on is the case
            // that matters; drag the bar slider to move the loop.
            if (loop) transport.setLoop(undefined);
            else transport.setLoopMeasures(measureIndex, measureIndex);
          }}
        >
          ↻ Loop this bar
        </button>
        {loop && <span className="muted">Looping bar {score.measures[measureIndex]?.number}</span>}

        {tracks.length > 1 && (
          <fieldset className="tracks">
            <legend>Guide plays</legend>
            {tracks.map((track) => (
              <label key={track.id}>
                <input
                  type="checkbox"
                  checked={!(selection?.muted.has(track.id) ?? false)}
                  onChange={() => {
                    transport.setSelection({
                      muted: toggle(selection?.muted, track.id),
                      soloed: selection?.soloed ?? new Set(),
                    });
                  }}
                />
                {track.name}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      {devices.length === 0 ? (
        <p className="muted">
          No MIDI destination — your keyboard may not accept incoming notes, or may need its
          &ldquo;local off&rdquo; setting changed.
        </p>
      ) : (
        <div className="transport-row">
          <label className="device-picker">
            Play through
            <select
              value={selectedId ?? ''}
              onChange={(event) => {
                output?.select(event.target.value || undefined);
              }}
            >
              <option value="">Nothing (silent)</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.manufacturer && ` — ${device.manufacturer}`}
                </option>
              ))}
            </select>
          </label>

          {/*
            The practise/listen switch. It gates the sends rather than the
            connection, so it can be flipped mid-piece — which is the whole
            point, and why it is not just "pick no device".
          */}
          <label className="guide-switch">
            <input
              type="checkbox"
              checked={guideAudible}
              onChange={(event) => {
                transport.setGuideAudible(event.target.checked);
              }}
            />
            Send guide to MIDI out
          </label>
        </div>
      )}
    </section>
  );
}

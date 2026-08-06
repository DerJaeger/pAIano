import type { PracticeSession } from '../core/practice/session';
import { accuracy, attempts, timingAccuracy, type BarStats } from '../core/practice/stats';
import type { PracticeMode } from '../core/practice/types';
import { isAudible, tracksOf } from '../core/score/tracks';
import type { Score } from '../core/score/types';
import type { Transport } from '../core/transport/transport';
import { VERDICT_COLORS } from './feedback';
import { noteName } from './format';
import { useTransportState } from './useTransport';
import type { PracticeSnapshot } from './usePractice';

const MODES: { mode: PracticeMode; label: string; hint: string }[] = [
  { mode: 'listen', label: 'Listen', hint: 'Play it for me. Nothing is judged.' },
  { mode: 'followYou', label: 'Follow you', hint: 'The music waits for each note.' },
  { mode: 'playAlong', label: 'Play along', hint: 'Fixed tempo, and you are scored.' },
];

const percent = (value: number | undefined) =>
  value === undefined ? '—' : `${String(Math.round(value * 100))}%`;

/**
 * Phase 5: pick how strict the piece is with you, and see how it went.
 *
 * There is deliberately no "which hand am I practising" control here — muting
 * the guide in the transport panel above already says it, and the notes you are
 * expected to play are exactly the ones it leaves out.
 */
export function PracticePanel({
  score,
  session,
  practice,
  transport,
  onSeekBar,
}: {
  score: Score;
  session: PracticeSession | undefined;
  practice: PracticeSnapshot;
  transport: Transport | undefined;
  onSeekBar: (measureIndex: number) => void;
}) {
  const { selection } = useTransportState(transport);
  const { mode, stats, waiting, owed, recent } = practice;

  if (!session) {
    return (
      <section className="practice">
        <h2>Practice</h2>
        <p className="muted">
          Connect a keyboard and open a score, and this is where the feedback goes.
        </p>
      </section>
    );
  }

  const yours = selection ? tracksOf(score).filter((track) => !isAudible(track.id, selection)) : [];
  const judged = attempts(stats);

  return (
    <section className="practice">
      <div className="practice-header">
        <h2>Practice</h2>
        <p className="muted">
          You play{' '}
          {yours.length === 0
            ? 'along with everything — mute a hand above to take it on yourself'
            : yours.map((track) => track.name.toLowerCase()).join(' and ')}
          .
        </p>
      </div>

      <fieldset className="modes">
        <legend className="visually-hidden">Practice mode</legend>
        {MODES.map((option) => (
          <label key={option.mode} className="mode">
            <input
              type="radio"
              name="practice-mode"
              value={option.mode}
              checked={mode === option.mode}
              onChange={() => {
                session.setMode(option.mode);
              }}
            />
            <span className="mode-label">{option.label}</span>
            <span className="muted mode-hint">{option.hint}</span>
          </label>
        ))}
      </fieldset>

      {waiting && (
        <p className="waiting" role="status">
          Waiting for {owed.map(noteName).join(' · ')}
          <span className="muted"> — or press play to skip it.</span>
        </p>
      )}

      {mode !== 'listen' && (
        <>
          <div className="scoreline">
            <Figure label="Right notes" value={percent(accuracy(stats))} />
            <Figure label="In time" value={percent(timingAccuracy(stats))} />
            <Figure label="Wrong" value={String(stats.wrong)} />
            <Figure label="Missed" value={String(stats.missed)} />
            <button
              type="button"
              className="button"
              onClick={() => {
                session.reset();
              }}
              disabled={judged === 0}
            >
              Reset score
            </button>
          </div>

          {judged === 0 ? (
            <p className="muted">Press play and start playing.</p>
          ) : (
            <Heatmap score={score} bars={stats.bars} onSeekBar={onSeekBar} />
          )}

          {recent[0] && (
            <p className="muted last-note" aria-live="polite">
              Last: {noteName(recent[0].midiNote)} — {recent[0].verdict}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <p className="figure">
      <span className="figure-value">{value}</span>
      <span className="muted figure-label">{label}</span>
    </p>
  );
}

/**
 * A bar-by-bar strip of where it went wrong. Each bar is a button, because the
 * thing you want to do about a red bar is go and play it again.
 */
function Heatmap({
  score,
  bars,
  onSeekBar,
}: {
  score: Score;
  bars: ReadonlyMap<number, BarStats>;
  onSeekBar: (measureIndex: number) => void;
}) {
  return (
    <div className="heatmap" role="group" aria-label="Errors by bar">
      {score.measures.map((measure, index) => {
        const bar = bars.get(index);
        return (
          <button
            key={measure.index}
            type="button"
            className="heat-bar"
            style={{ background: heatColor(bar) }}
            title={describe(measure.number, bar)}
            aria-label={describe(measure.number, bar)}
            onClick={() => {
              onSeekBar(index);
            }}
          />
        );
      })}
    </div>
  );
}

/** Untouched bars stay neutral; the rest run from correct-green to error-red. */
function heatColor(bar: BarStats | undefined): string {
  if (bar === undefined || bar.notes + bar.errors === 0) return 'var(--heat-empty)';
  if (bar.errors === 0) return VERDICT_COLORS.correct;
  const share = Math.min(1, bar.errors / Math.max(bar.notes, bar.errors));
  return share < 0.5 ? VERDICT_COLORS.late : VERDICT_COLORS.wrong;
}

function describe(number: string, bar: BarStats | undefined): string {
  if (bar === undefined) return `Bar ${number}: not played yet`;
  if (bar.errors === 0) return `Bar ${number}: all ${String(bar.notes)} notes right`;
  return `Bar ${number}: ${String(bar.errors)} of ${String(bar.notes)} wrong`;
}

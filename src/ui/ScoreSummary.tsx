import type { Score } from '../core/score/types';
import { formatDuration, noteName, round } from './format';

/** What the parser understood — the honest, pre-notation view of a score. */
export function ScoreSummary({ score }: { score: Score }) {
  const totalSeconds = score.tempoMap.tickToSeconds(score.durationTicks);
  const repeated = score.playbackOrder.length > score.measures.length;

  return (
    <section className="summary">
      <h2>{score.title}</h2>
      <dl>
        <Fact label="Parts">
          {score.parts.map((part) => `${part.name} (${String(part.staffCount)} staves)`).join(', ')}
        </Fact>
        <Fact label="Measures">
          {score.measures.length}
          {repeated && ` written, ${String(score.playbackOrder.length)} played`}
        </Fact>
        <Fact label="Notes">{score.events.length}</Fact>
        <Fact label="Duration">{formatDuration(totalSeconds)}</Fact>
        <Fact label="Tempo">
          {score.tempoMap.changes.map((change) => Math.round(change.bpm)).join(' → ')} bpm
        </Fact>
      </dl>

      <h3>First notes</h3>
      <table>
        <thead>
          <tr>
            <th>Bar</th>
            <th>Time</th>
            <th>Note</th>
            <th>Beats</th>
            <th>Hand</th>
          </tr>
        </thead>
        <tbody>
          {score.events.slice(0, 20).map((event, index) => (
            <tr key={`${event.xmlId}-${String(index)}`}>
              <td>{score.measures[event.measureIndex]?.number ?? '?'}</td>
              <td>{formatDuration(score.tempoMap.tickToSeconds(event.startTick))}</td>
              <td>{noteName(event.midiNote)}</td>
              <td>{round(event.durationTicks / score.ticksPerQuarter)}</td>
              <td>{event.staff === 1 ? 'right' : 'left'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

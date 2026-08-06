// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeMidiInput } from '../core/midi/fakeMidiInput';
import { RecordingMidiOutput } from '../core/midi/output';
import { PracticeSession } from '../core/practice/session';
import { applyJudgements, EMPTY_STATS } from '../core/practice/stats';
import type { Judgement, Verdict } from '../core/practice/types';
import { attributes, note, score as scoreXml, tempo } from '../core/score/musicxml/fixtures';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import { FakeClock } from '../core/transport/clock';
import { Transport } from '../core/transport/transport';
import { PracticePanel } from './PracticePanel';
import type { PracticeSnapshot } from './usePractice';

const score = parseMusicXml(
  scoreXml([[tempo(120) + attributes(1) + note('C', 4, 4), note('D', 4, 4)]]),
);

const judged = (verdict: Verdict, measureIndex: number): Judgement => ({
  verdict,
  midiNote: 60,
  tick: 0,
  note: undefined,
  offsetTicks: undefined,
  measureIndex,
});

const IDLE: PracticeSnapshot = {
  mode: 'listen',
  stats: EMPTY_STATS,
  recent: [],
  results: new Map(),
  waiting: false,
  owed: [],
};

function show(snapshot: Partial<PracticeSnapshot> = {}, onSeekBar = vi.fn()) {
  const clock = new FakeClock(1000);
  const output = new RecordingMidiOutput(() => clock.now());
  const transport = new Transport({ score, output, clock });
  const input = new FakeMidiInput();
  const session = new PracticeSession({ score, transport, input });
  const user = userEvent.setup();

  render(
    <PracticePanel
      score={score}
      session={session}
      practice={{ ...IDLE, ...snapshot }}
      transport={transport}
      onSeekBar={onSeekBar}
    />,
  );
  return { session, transport, user, onSeekBar };
}

describe('PracticePanel', () => {
  it('says there is nothing to judge until a keyboard is connected', () => {
    render(
      <PracticePanel
        score={score}
        session={undefined}
        practice={IDLE}
        transport={undefined}
        onSeekBar={vi.fn()}
      />,
    );

    expect(screen.getByText(/Connect a keyboard/)).toBeTruthy();
  });

  it('starts in Listen, where nothing is scored', () => {
    show();

    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Listen/ }).checked).toBe(true);
    expect(screen.queryByText('Right notes')).toBeNull();
  });

  it('changes the mode of the session you are practising in', async () => {
    const { session, user } = show();

    await user.click(screen.getByRole('radio', { name: /Follow you/ }));

    expect(session.getMode()).toBe('followYou');
  });

  it('names the notes the music is waiting for', () => {
    show({ mode: 'followYou', waiting: true, owed: [60, 64] });

    expect(screen.getByRole('status').textContent).toContain('Waiting for C4 · E4');
  });

  it('shows the running score once notes have been judged', () => {
    const stats = applyJudgements(EMPTY_STATS, [
      judged('correct', 0),
      judged('late', 0),
      judged('missed', 1),
      judged('wrong', 1),
    ]);
    show({ mode: 'playAlong', stats });

    // Two of the four judgements were the right note, and one of those two was
    // also in time.
    expect(screen.getByText('Right notes').parentElement?.textContent).toContain('50%');
    expect(screen.getByText('In time').parentElement?.textContent).toContain('50%');
  });

  it('says which hand is yours to play', () => {
    const { transport } = show();

    expect(screen.getByText(/You play along with everything/)).toBeTruthy();
    expect(transport.getSelection().muted.size).toBe(0);
  });

  it('sends you to a bar you keep getting wrong', async () => {
    const stats = applyJudgements(EMPTY_STATS, [judged('missed', 1)]);
    const { user, onSeekBar } = show({ mode: 'playAlong', stats });

    await user.click(screen.getByRole('button', { name: /Bar 2/ }));

    expect(onSeekBar).toHaveBeenCalledWith(1);
  });

  it('clears the score on request', async () => {
    const stats = applyJudgements(EMPTY_STATS, [judged('wrong', 0)]);
    const { session, user } = show({ mode: 'playAlong', stats });

    await user.click(screen.getByRole('button', { name: 'Reset score' }));

    expect(session.getStats()).toBe(EMPTY_STATS);
  });
});

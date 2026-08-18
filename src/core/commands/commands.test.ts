import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingMidiOutput } from '../midi/output';
import { attributes, backup, note, score as scoreXml, tempo } from '../score/musicxml/fixtures';
import { parseMusicXml } from '../score/musicxml/parseMusicXml';
import type { Score } from '../score/types';
import { FakeClock } from '../transport/clock';
import { Transport } from '../transport/transport';
import { runCommand } from './commands';

/** Four one-bar-per-note measures, so bar navigation has somewhere to go. */
function fourBars(): Score {
  const bar = (step: string) => note(step, 4, 4);
  return parseMusicXml(
    scoreXml([[tempo(120) + attributes(1) + bar('C'), bar('D'), bar('E'), bar('F')]]),
  );
}

/** Two staves, so the hands can be cycled. */
function hands(): Score {
  return parseMusicXml(
    scoreXml([
      [
        tempo(120) +
          attributes(1, { staves: 2 }) +
          note('C', 5, 4, { staff: 1 }) +
          backup(4) +
          note('C', 3, 4, { staff: 2, voice: '2' }),
      ],
    ]),
  );
}

let clock: FakeClock;
let output: RecordingMidiOutput;

beforeEach(() => {
  clock = new FakeClock(1000);
  output = new RecordingMidiOutput(() => clock.now());
});

function context(score: Score = fourBars()) {
  const transport = new Transport({ score, output, clock });
  return { score, transport };
}

/** The written bar the transport is parked on. */
function barOf(context: { score: Score; transport: Transport }): number {
  return Math.floor(context.transport.getPositionTick() / (context.score.ticksPerQuarter * 4));
}

describe('runCommand, playing', () => {
  it('plays and pauses on the one command', () => {
    const ctx = context();

    runCommand('playPause', ctx);
    expect(ctx.transport.getState()).toBe('playing');

    runCommand('playPause', ctx);
    expect(ctx.transport.getState()).toBe('paused');
  });

  it('stops', () => {
    const ctx = context();
    runCommand('playPause', ctx);

    runCommand('stop', ctx);

    expect(ctx.transport.getState()).toBe('stopped');
    expect(ctx.transport.getPositionTick()).toBe(0);
  });

  it('restarts the piece without stopping it', () => {
    const ctx = context();
    runCommand('playPause', ctx);
    ctx.transport.seekMeasure(2);

    runCommand('restartSong', ctx);

    expect(ctx.transport.getPositionTick()).toBe(0);
    expect(ctx.transport.getState()).toBe('playing');
  });
});

describe('runCommand, moving between bars', () => {
  it('restarts the bar it is in, from anywhere in that bar', () => {
    const ctx = context();
    ctx.transport.seekTick(ctx.score.ticksPerQuarter * 9); // bar 3, one beat in

    runCommand('restartBar', ctx);

    expect(barOf(ctx)).toBe(2);
    expect(ctx.transport.getPositionTick()).toBe(ctx.score.ticksPerQuarter * 8);
  });

  it('steps to the next bar and back', () => {
    const ctx = context();

    runCommand('nextBar', ctx);
    expect(barOf(ctx)).toBe(1);

    runCommand('previousBar', ctx);
    expect(barOf(ctx)).toBe(0);
  });

  it('stays put at either end rather than falling off', () => {
    const ctx = context();

    runCommand('previousBar', ctx);
    expect(barOf(ctx)).toBe(0);

    for (let step = 0; step < 10; step++) runCommand('nextBar', ctx);
    expect(barOf(ctx)).toBe(3);
  });

  it('loops the bar it is on, and unloops it', () => {
    const ctx = context();
    ctx.transport.seekMeasure(1);

    runCommand('repeatBar', ctx);
    expect(ctx.transport.getLoop()).toEqual({
      startTick: ctx.score.ticksPerQuarter * 4,
      endTick: ctx.score.ticksPerQuarter * 8,
    });

    runCommand('repeatBar', ctx);
    expect(ctx.transport.getLoop()).toBeUndefined();
  });
});

describe('runCommand, the rest of the panel', () => {
  it('steps the tempo up and down the same ladder the dropdown offers', () => {
    const ctx = context();

    runCommand('tempoDown', ctx);
    expect(ctx.transport.getSpeed()).toBe(0.75);

    runCommand('tempoUp', ctx);
    expect(ctx.transport.getSpeed()).toBe(1);
  });

  it('stops at the ends of the tempo ladder', () => {
    const ctx = context();

    for (let step = 0; step < 10; step++) runCommand('tempoDown', ctx);
    expect(ctx.transport.getSpeed()).toBe(0.25);

    for (let step = 0; step < 10; step++) runCommand('tempoUp', ctx);
    expect(ctx.transport.getSpeed()).toBe(1.5);
  });

  it('toggles the guide output', () => {
    const ctx = context();

    runCommand('toggleGuideOutput', ctx);
    expect(ctx.transport.isGuideAudible()).toBe(false);

    runCommand('toggleGuideOutput', ctx);
    expect(ctx.transport.isGuideAudible()).toBe(true);
  });

  it('cycles the guide through both hands, right only, left only', () => {
    const ctx = context(hands());

    expect(ctx.transport.getSelection().muted.size).toBe(0);

    runCommand('cycleHands', ctx);
    expect([...ctx.transport.getSelection().muted]).toEqual(['P1/1']);

    runCommand('cycleHands', ctx);
    expect([...ctx.transport.getSelection().muted]).toEqual(['P1/2']);

    runCommand('cycleHands', ctx);
    expect(ctx.transport.getSelection().muted.size).toBe(0);
  });

  it('leaves a single-staff score alone rather than muting the only part', () => {
    const ctx = context();

    runCommand('cycleHands', ctx);

    expect(ctx.transport.getSelection().muted.size).toBe(0);
  });

  it('asks the UI for the cheat sheet, which core has nowhere to put', () => {
    const onShowHelp = vi.fn();
    const ctx = { ...context(), onShowHelp };

    runCommand('showHelp', ctx);

    expect(onShowHelp).toHaveBeenCalledOnce();
  });

  it('finds a piece with nothing open at all', () => {
    // The whole point: you press it *because* nothing is open. A context with
    // no score must still reach the library.
    const onFindSong = vi.fn();

    runCommand('findSong', { onFindSong });

    expect(onFindSong).toHaveBeenCalledOnce();
  });

  it('shows the cheat sheet with nothing open', () => {
    const onShowHelp = vi.fn();

    runCommand('showHelp', { onShowHelp });

    expect(onShowHelp).toHaveBeenCalledOnce();
  });

  it('shrugs off a transport command when there is no transport', () => {
    expect(() => {
      runCommand('playPause', {});
      runCommand('nextBar', {});
      runCommand('cycleHands', {});
    }).not.toThrow();
  });

  it('does nothing for a command the surface cannot handle', () => {
    const ctx = context();

    expect(() => {
      runCommand('showHelp', ctx);
    }).not.toThrow();
  });
});

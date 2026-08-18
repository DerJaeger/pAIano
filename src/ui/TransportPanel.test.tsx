// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordingMidiOutput } from '../core/midi/output';
import {
  attributes,
  backup,
  note,
  score as scoreXml,
  tempo,
} from '../core/score/musicxml/fixtures';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import { FakeClock } from '../core/transport/clock';
import { Transport } from '../core/transport/transport';
import { readSetting } from './settings';
import { TransportPanel } from './TransportPanel';

const musicXml = scoreXml([
  [
    tempo(120) +
      attributes(1, { staves: 2 }) +
      note('C', 5, 4, { staff: 1 }) +
      backup(4) +
      note('C', 3, 4, { staff: 2, voice: '2' }),
    note('D', 5, 4, { staff: 1 }),
  ],
]);
const score = parseMusicXml(musicXml);

function show(options: { positionTick?: number } = {}) {
  const clock = new FakeClock(1000);
  const output = new RecordingMidiOutput(() => clock.now());
  const transport = new Transport({ score, output, clock });
  const user = userEvent.setup();

  render(
    <TransportPanel
      score={score}
      transport={transport}
      output={output}
      positionTick={options.positionTick ?? 0}
    />,
  );
  return { transport, output, clock, user };
}

beforeEach(() => {
  localStorage.clear();
});

describe('TransportPanel', () => {
  it('plays and pauses', async () => {
    const { transport, user } = show();

    await user.click(screen.getByRole('button', { name: /Play/ }));
    expect(transport.getState()).toBe('playing');

    await user.click(screen.getByRole('button', { name: /Pause/ }));
    expect(transport.getState()).toBe('paused');
  });

  it('stops and rewinds', async () => {
    const { transport, user } = show();

    await user.click(screen.getByRole('button', { name: /Play/ }));
    await user.click(screen.getByRole('button', { name: /Stop/ }));

    expect(transport.getState()).toBe('stopped');
    expect(transport.getPositionTick()).toBe(0);
  });

  it('slows the guide down', async () => {
    const { transport, user } = show();

    await user.selectOptions(screen.getByRole('combobox', { name: /speed/i }), '0.5');

    expect(transport.getSpeed()).toBe(0.5);
  });

  it('loops the bar the cursor is on', async () => {
    const { transport, user } = show({ positionTick: score.ticksPerQuarter * 4 });

    await user.click(screen.getByRole('button', { name: /Loop this bar/ }));

    expect(transport.getLoop()).toEqual({
      startTick: score.ticksPerQuarter * 4,
      endTick: score.ticksPerQuarter * 8,
    });

    await user.click(screen.getByRole('button', { name: /Loop this bar/ }));
    expect(transport.getLoop()).toBeUndefined();
  });

  it('mutes the hand you are practising', async () => {
    const { transport, user } = show();

    await user.click(screen.getByRole('checkbox', { name: 'Right hand' }));

    expect(transport.getSelection().muted).toEqual(new Set(['P1/1']));
    expect(screen.getByRole('checkbox', { name: 'Left hand' })).toHaveProperty('checked', true);
  });

  it('counts in when asked', async () => {
    const { transport, output, user } = show();

    await user.click(screen.getByRole('checkbox', { name: /Count in/ }));
    act(() => {
      transport.play();
      transport.tick();
    });

    // Four woodblock clicks on the percussion channel, before any music.
    expect(output.sent.filter((sent) => sent.channel === 9)).toHaveLength(4);
  });

  it('switches the guide off without dropping the device', async () => {
    const { transport, output, user } = show();
    const device = output.getSelectedDeviceId();

    await user.click(screen.getByRole('checkbox', { name: /Send guide to MIDI out/i }));

    expect(transport.isGuideAudible()).toBe(false);
    // The point of the switch: the instrument stays connected, so flipping back
    // is instant rather than a trip through the device picker.
    expect(output.getSelectedDeviceId()).toBe(device);
  });

  it('remembers the guide switch across a reload', async () => {
    const { user } = show();

    await user.click(screen.getByRole('checkbox', { name: /Send guide to MIDI out/i }));

    expect(readSetting('guideAudible', true)).toBe(false);
  });

  it('shows the switch as the transport has it', () => {
    const clock = new FakeClock(1000);
    const output = new RecordingMidiOutput(() => clock.now());
    const transport = new Transport({ score, output, clock });
    transport.setGuideAudible(false);

    render(<TransportPanel score={score} transport={transport} output={output} positionTick={0} />);

    expect(screen.getByRole('checkbox', { name: /Send guide to MIDI out/i })).toHaveProperty(
      'checked',
      false,
    );
  });

  it('can send the guide nowhere', async () => {
    const { output, user } = show();

    await user.selectOptions(screen.getByRole('combobox', { name: /play through/i }), '');

    expect(output.getSelectedDeviceId()).toBeUndefined();
  });

  it('explains itself when there is nothing to play through', () => {
    render(
      <TransportPanel score={score} transport={undefined} output={undefined} positionTick={0} />,
    );

    expect(screen.getByText(/Connect a MIDI instrument/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Play/ })).toBeNull();
  });
});

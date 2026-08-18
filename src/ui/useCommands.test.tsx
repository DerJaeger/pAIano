// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_BINDINGS } from '../core/commands/bindings';
import { FakeMidiInput } from '../core/midi/fakeMidiInput';
import { RecordingMidiOutput } from '../core/midi/output';
import { attributes, note, score as scoreXml, tempo } from '../core/score/musicxml/fixtures';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import { FakeClock } from '../core/transport/clock';
import { Transport } from '../core/transport/transport';
import { useCommands } from './useCommands';

const score = parseMusicXml(
  scoreXml([[tempo(120) + attributes(1) + note('C', 4, 4), note('D', 4, 4), note('E', 4, 4)]]),
);

function Harness({
  transport,
  input,
  enabled = true,
}: {
  transport: Transport;
  input: FakeMidiInput;
  enabled?: boolean;
}) {
  useCommands({ score, transport }, input, DEFAULT_BINDINGS, enabled);
  return <input aria-label="a text field" />;
}

let clock: FakeClock;
let transport: Transport;
let input: FakeMidiInput;

beforeEach(() => {
  clock = new FakeClock(1000);
  transport = new Transport({ score, output: new RecordingMidiOutput(() => clock.now()), clock });
  input = new FakeMidiInput();
  // Real MIDI events are stamped in the `performance.now()` domain, which is
  // what the hook ticks the recogniser with; starting the fake at 0 would leave
  // the two clocks talking past each other.
  input.now = performance.now();
  render(<Harness transport={transport} input={input} />);
});

describe('keyboard commands', () => {
  it('plays and pauses on the space bar', async () => {
    const user = userEvent.setup();

    await user.keyboard(' ');
    expect(transport.getState()).toBe('playing');

    await user.keyboard(' ');
    expect(transport.getState()).toBe('paused');
  });

  it('steps between bars with the arrow keys', async () => {
    const user = userEvent.setup();

    await user.keyboard('{ArrowRight}');

    expect(transport.getPositionTick()).toBe(score.ticksPerQuarter * 4);
  });

  it('keeps its hands off a text field', async () => {
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('a text field'));
    await user.keyboard(' ');

    // Typing a space into a search box must type a space, not start the music.
    expect(transport.getState()).toBe('stopped');
  });

  it('stands down while something else owns the keyboard', async () => {
    // The cheat sheet is capturing a key to bind, or the fuzzy finder is being
    // typed into: either way a key press is not a command.
    cleanup();
    render(<Harness transport={transport} input={input} enabled={false} />);
    const user = userEvent.setup();

    await user.keyboard(' ');

    expect(transport.getState()).toBe('stopped');
  });

  it('leaves unbound browser shortcuts alone', async () => {
    const user = userEvent.setup();

    await user.keyboard('{Control>} {/Control}');

    expect(transport.getState()).toBe('stopped');
  });
});

describe('pedal gestures', () => {
  it('restarts the bar on a double tap of the sustain pedal', async () => {
    transport.seekMeasure(2);
    const start = transport.getPositionTick();
    transport.seekTick(start + score.ticksPerQuarter);

    input.pedal(true);
    input.advance(60);
    input.pedal(false);
    input.advance(100);
    input.pedal(true);
    input.advance(60);
    input.pedal(false);

    // The gesture is recognised by the silence after it, which the hook's own
    // ticker notices — comfortably past the chain gap plus one tick.
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(transport.getPositionTick()).toBe(start);
  });
});

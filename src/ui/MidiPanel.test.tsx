// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MidiPanel } from './MidiPanel';
import { FakeMidiInput } from '../core/midi/fakeMidiInput';
import { MidiUnavailableError } from '../adapters/midi/webMidiAdapter';

async function connect(midi: FakeMidiInput = new FakeMidiInput()) {
  const user = userEvent.setup();
  render(<MidiPanel open={() => Promise.resolve(midi)} />);
  await user.click(screen.getByRole('button', { name: 'Connect a keyboard' }));
  return { midi, user };
}

describe('MidiPanel', () => {
  it('shows the connected devices once you connect', async () => {
    const { midi } = await connect(
      new FakeMidiInput([
        { id: 'in-1', name: 'Digital Piano', manufacturer: 'Acme' },
        { id: 'in-2', name: 'Drum Pad', manufacturer: 'Acme' },
      ]),
    );

    const picker = await screen.findByRole('combobox', { name: /device/i });
    expect(screen.getByRole('option', { name: /Digital Piano/ })).toBeDefined();
    expect((picker as HTMLSelectElement).value).toBe(midi.getSelectedDeviceId());
  });

  it('lights up the keys you are holding', async () => {
    const { midi } = await connect();
    await screen.findByRole('img', { name: 'No keys down' });

    act(() => {
      midi.press(60);
      midi.press(64);
    });
    expect(screen.getByRole('img', { name: 'Sounding: C4, E4' })).toBeDefined();
    expect(screen.getByText('C4 · E4')).toBeDefined();

    act(() => {
      midi.release(60);
    });
    expect(screen.getByRole('img', { name: 'Sounding: E4' })).toBeDefined();
  });

  it('keeps notes lit while the sustain pedal is down', async () => {
    const { midi } = await connect();
    await screen.findByRole('img', { name: 'No keys down' });

    act(() => {
      midi.press(60);
      midi.pedal(true);
      midi.release(60);
    });
    expect(screen.getByText('C4 — sustain')).toBeDefined();

    act(() => {
      midi.pedal(false);
    });
    expect(screen.getByRole('img', { name: 'No keys down' })).toBeDefined();
  });

  it('switches to another device', async () => {
    const { midi, user } = await connect(
      new FakeMidiInput([
        { id: 'in-1', name: 'Digital Piano', manufacturer: 'Acme' },
        { id: 'in-2', name: 'Drum Pad', manufacturer: 'Acme' },
      ]),
    );

    await user.selectOptions(await screen.findByRole('combobox', { name: /device/i }), 'in-2');
    expect(midi.getSelectedDeviceId()).toBe('in-2');
  });

  it('picks up a keyboard plugged in after connecting', async () => {
    const { midi } = await connect(new FakeMidiInput([]));
    expect(await screen.findByText(/No MIDI devices found/)).toBeDefined();

    act(() => {
      midi.attach({ id: 'in-1', name: 'Digital Piano', manufacturer: 'Acme' });
    });
    expect(screen.getByRole('option', { name: /Digital Piano/ })).toBeDefined();
  });

  it('explains why MIDI is unavailable instead of failing silently', async () => {
    const user = userEvent.setup();
    render(
      <MidiPanel
        open={() =>
          Promise.reject(new MidiUnavailableError('unsupported', 'This browser has no Web MIDI.'))
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Connect a keyboard' }));

    expect((await screen.findByRole('alert')).textContent).toContain('no Web MIDI');
    expect(screen.getByRole('button', { name: 'Connect a keyboard' })).toBeDefined();
  });
});

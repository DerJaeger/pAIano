// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ScoreView } from './ScoreView';
import { pitchColor } from './noteColors';
import { FakeMidiInput } from '../core/midi/fakeMidiInput';
import { FakeNotation } from '../core/notation/fakeNotation';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import { attributes, note, score as scoreXml } from '../core/score/musicxml/fixtures';

const musicXml = scoreXml([
  [
    `${attributes(1)}${note('C', 4, 1)}${note('D', 4, 1)}${note('E', 4, 1)}${note('F', 4, 1)}`,
    `${note('G', 4, 4)}`,
    `${note('A', 4, 4)}`,
  ],
]);
const score = parseMusicXml(musicXml);

/** The bar is owned by `App` in the real thing; this stands in for that. */
function Browser({ notation }: { notation: FakeNotation }) {
  const [bar, setBar] = useState(0);
  return (
    <ScoreView
      score={score}
      musicXml={musicXml}
      position={{ measureIndex: bar, tickInMeasure: 0, pass: 0 }}
      onSeekBar={setBar}
      createNotation={() => Promise.resolve(notation)}
    />
  );
}

async function show(notation = new FakeNotation()) {
  const user = userEvent.setup();
  render(<Browser notation={notation} />);
  await waitFor(() => {
    expect(notation.loaded).toBe(musicXml);
  });
  return { notation, user };
}

describe('ScoreView', () => {
  it('renders the score and puts the cursor on the first bar', async () => {
    const { notation } = await show();
    await waitFor(() => {
      expect(notation.cursor?.measureIndex).toBe(0);
    });
    expect(screen.getByText('Bar 1 of 3')).toBeDefined();
    expect(notation.visibleSystems).toBe(3);
  });

  it('highlights the notes written in the bar under the cursor', async () => {
    const { notation } = await show();
    await waitFor(() => {
      expect(notation.highlights).toHaveLength(4);
    });
    expect(notation.highlights.map((highlight) => highlight.note.midiNote)).toEqual([
      60, 62, 64, 65,
    ]);
  });

  it('draws practice feedback over the bar highlight', async () => {
    const notation = new FakeNotation();
    const red = { note: { measureIndex: 0, midiNote: 62, tickInMeasure: 96 }, color: '#a3231b' };
    render(
      <ScoreView
        score={score}
        musicXml={musicXml}
        position={{ measureIndex: 0, tickInMeasure: 0, pass: 0 }}
        feedback={[red]}
        onSeekBar={() => undefined}
        createNotation={() => Promise.resolve(notation)}
      />,
    );

    await waitFor(() => {
      expect(notation.highlights).toHaveLength(5);
    });
    // Last wins in the renderer, so the note you got wrong shows as wrong
    // rather than as "on the bar the cursor is on".
    expect(notation.highlights[4]).toEqual(red);
  });

  it('drives the cursor to any bar', async () => {
    const { notation, user } = await show();

    await user.click(screen.getByRole('button', { name: /Next bar/ }));
    await waitFor(() => {
      expect(notation.cursor?.measureIndex).toBe(1);
    });
    expect(screen.getByText('Bar 2 of 3')).toBeDefined();
    expect(notation.highlights.map((highlight) => highlight.note.midiNote)).toEqual([67]);

    await user.click(screen.getByRole('button', { name: /Previous bar/ }));
    await waitFor(() => {
      expect(notation.cursor?.measureIndex).toBe(0);
    });
  });

  it('stops at the ends of the piece', async () => {
    const { user } = await show();
    expect(screen.getByRole('button', { name: /Previous bar/ })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: /Next bar/ }));
    await user.click(screen.getByRole('button', { name: /Next bar/ }));
    expect(screen.getByText('Bar 3 of 3')).toBeDefined();
    expect(screen.getByRole('button', { name: /Next bar/ })).toHaveProperty('disabled', true);
  });

  it('zooms in and out', async () => {
    const { notation, user } = await show();
    expect(notation.zoom).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => {
      expect(notation.zoom).toBeGreaterThan(1);
    });
    expect(screen.getByText('125%')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await waitFor(() => {
      expect(notation.zoom).toBe(1);
    });
  });

  it('writes the note names on the sheet on request', async () => {
    const { notation, user } = await show();
    expect(notation.noteLabels).toBe(false);

    await user.click(screen.getByLabelText('Note names'));
    await waitFor(() => {
      expect(notation.noteLabels).toBe(true);
    });

    await user.click(screen.getByLabelText('Note names'));
    await waitFor(() => {
      expect(notation.noteLabels).toBe(false);
    });
  });

  it('colours every note by pitch instead of highlighting the bar', async () => {
    const { notation, user } = await show();

    await user.click(screen.getByLabelText('Colour by pitch'));
    await waitFor(() => {
      // Every note on the page, rather than the four in the bar the cursor is
      // on — and no bar highlight left over on top of them.
      expect(notation.highlights).toHaveLength(6);
    });
    expect(notation.highlights.map((highlight) => highlight.color)).toEqual(
      [60, 62, 64, 65, 67, 69].map(pitchColor),
    );

    await user.click(screen.getByLabelText('Colour by pitch'));
    await waitFor(() => {
      expect(notation.highlights).toHaveLength(4);
    });
  });

  it('shows the keys you are holding, until you ask it not to', async () => {
    const input = new FakeMidiInput();
    const notation = new FakeNotation();
    render(
      <ScoreView
        score={score}
        musicXml={musicXml}
        position={{ measureIndex: 0, tickInMeasure: 0, pass: 0 }}
        input={input}
        onSeekBar={() => undefined}
        createNotation={() => Promise.resolve(notation)}
      />,
    );
    await waitFor(() => {
      expect(notation.loaded).toBe(musicXml);
    });

    act(() => {
      input.chord([60, 64]);
    });
    await waitFor(() => {
      expect(notation.heldNotes).toEqual([60, 64]);
    });

    act(() => {
      input.release(60);
    });
    await waitFor(() => {
      expect(notation.heldNotes).toEqual([64]);
    });

    // Off means off, even with a key still down.
    await userEvent.click(screen.getByLabelText('Show what I play'));
    await waitFor(() => {
      expect(notation.heldNotes).toEqual([]);
    });
  });

  it('says so when a score cannot be engraved', async () => {
    const notation = new FakeNotation();
    notation.failWith = new Error('unsupported notation');
    render(<Browser notation={notation} />);

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('unsupported notation'),
    );
  });

  it('tears the renderer down when it goes away', async () => {
    const notation = new FakeNotation();
    const { unmount } = render(<Browser notation={notation} />);
    await waitFor(() => {
      expect(notation.loaded).toBe(musicXml);
    });

    unmount();
    expect(notation.destroyed).toBe(true);
  });
});

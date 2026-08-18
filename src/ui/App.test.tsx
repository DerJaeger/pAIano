// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FakeLibrary } from '../core/library/port';
import { attributes, note, score as scoreXml, tempo } from '../core/score/musicxml/fixtures';
import { App } from './App';
import { writeSetting } from './settings';

const musicXml = scoreXml([[tempo(120) + attributes(1) + note('C', 4, 4), note('D', 4, 4)]], {
  title: 'Two Bars',
});

const tree = { 'Bach/Two Bars.musicxml': musicXml };

beforeEach(() => {
  localStorage.clear();
});

describe('reopening what you had open', () => {
  it('reopens the last piece once the folder can be read', async () => {
    writeSetting('lastScorePath', 'Bach/Two Bars.musicxml');

    render(<App library={new FakeLibrary(tree)} />);

    // No library trip and no file dialog: it comes back on its own.
    await waitFor(() => {
      expect(screen.getByText(/Bar 1 of 2/)).toBeDefined();
    });
  });

  it('waits rather than failing when the folder is not readable yet', async () => {
    writeSetting('lastScorePath', 'Bach/Two Bars.musicxml');
    const port = new FakeLibrary(tree, { access: 'prompt' });

    render(<App library={port} />);

    // Nothing can be read before the Reconnect click, so nothing is opened —
    // and nothing is reported as broken either.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open a piece/ })).toBeDefined();
    });
    expect(screen.queryByText(/Bar 1 of 2/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a remembered piece that is no longer in the library', async () => {
    writeSetting('lastScorePath', 'Bach/Deleted.musicxml');

    render(<App library={new FakeLibrary(tree)} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open a piece/ })).toBeDefined();
    });
    expect(screen.queryByText(/Bar 1 of 2/)).toBeNull();
  });
});

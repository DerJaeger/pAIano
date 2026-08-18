// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { MemoryCatalogCache } from '../core/library/cache';
import { FakeLibrary } from '../core/library/port';
import type { AccessState } from '../core/library/port';
import { LibrarySidebar } from './LibrarySidebar';
import { useLibrary } from './useLibrary';

const tree = {
  'Bach/Inventions/Invention 1 in C major.musicxml': '<score-partwise/>',
  'Bach/Inventions/Invention 15 in B minor.musicxml': '<score-partwise/>',
  'Beethoven/Sonata 14.musicxml': '<score-partwise/>',
  'notes.txt': 'not a score',
};

function Harness({
  port,
  onOpen,
  cache,
}: {
  port: FakeLibrary;
  onOpen: (path: string) => void;
  cache?: MemoryCatalogCache;
}) {
  const library = useLibrary(port, cache);
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <LibrarySidebar
      library={library}
      open={onOpen}
      onFocusChange={() => undefined}
      openPath={undefined}
      collapsed={collapsed}
      onToggleCollapsed={() => {
        setCollapsed((was) => !was);
      }}
      searchRef={searchRef}
    />
  );
}

function show(access: AccessState = 'granted') {
  const port = new FakeLibrary(tree, { access });
  const cache = new MemoryCatalogCache();
  const onOpen = vi.fn();
  render(<Harness port={port} onOpen={onOpen} cache={cache} />);
  return { port, cache, onOpen, user: userEvent.setup() };
}

/** Waits for the startup scan to have populated the list. */
async function listed() {
  await waitFor(() => {
    expect(screen.getAllByText('Invention 1 in C major').length).toBeGreaterThan(0);
  });
}

describe('the library sidebar', () => {
  it('offers to pick a folder before one is chosen', () => {
    const port = new FakeLibrary({}, { access: 'prompt' });
    port.rootName = undefined;
    render(<Harness port={port} onOpen={vi.fn()} cache={new MemoryCatalogCache()} />);

    expect(screen.getByRole('button', { name: /Choose music folder/ })).toBeDefined();
  });

  it('lists the scores it found, and nothing it cannot open', async () => {
    show();
    await listed();

    expect(screen.getByText('Invention 1 in C major')).toBeDefined();
    // notes.txt is in the tree; a row that dead-ends when clicked is worse than
    // no row at all.
    expect(screen.queryByText('notes')).toBeNull();
  });

  it('finds a piece from letters scattered through its path', async () => {
    const { user } = show();
    await listed();

    await user.type(screen.getByRole('searchbox', { name: /Find a piece/ }), 'bmin inv');

    await waitFor(() => {
      expect(screen.getByText('1 match')).toBeDefined();
    });
    expect(screen.getByText(/Invention 15 in B minor/)).toBeDefined();
  });

  it('opens the best match on Enter', async () => {
    const { user, onOpen } = show();
    await listed();

    const search = screen.getByRole('searchbox', { name: /Find a piece/ });
    await user.type(search, 'sonata{Enter}');

    expect(onOpen).toHaveBeenCalledWith('Beethoven/Sonata 14.musicxml');
  });

  it('stars a piece and shows it under Favourites', async () => {
    const { user } = show();
    await listed();

    await user.click(screen.getByRole('button', { name: /^Star Sonata 14/ }));

    await waitFor(() => {
      expect(screen.getByText('Favourites')).toBeDefined();
    });
  });

  it('asks to reconnect when the permission has lapsed, without hiding the library', async () => {
    const { cache } = show('granted');
    await listed();

    // Come back in a new session: same cached catalog, permission gone.
    const lapsed = new FakeLibrary(tree, { access: 'prompt' });
    render(<Harness port={lapsed} onOpen={vi.fn()} cache={cache} />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Reconnect music/ }).length).toBeGreaterThan(0);
    });
    // The measured payoff: the list is still there before the click.
    expect(screen.getAllByText('Invention 1 in C major').length).toBeGreaterThan(0);
  });

  it('collapses to a rail', async () => {
    const { user } = show();
    await listed();

    await user.click(screen.getByRole('button', { name: /Hide library/ }));

    expect(screen.queryByRole('searchbox', { name: /Find a piece/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Show library/ })).toBeDefined();
  });

  it('says so plainly on a browser that cannot remember a folder', async () => {
    const port = new FakeLibrary(tree, { access: 'unsupported' });
    render(<Harness port={port} onOpen={vi.fn()} cache={new MemoryCatalogCache()} />);

    await waitFor(() => {
      expect(screen.getByText(/cannot remember a folder/)).toBeDefined();
    });
  });
});

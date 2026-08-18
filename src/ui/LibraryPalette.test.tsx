// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryCatalogCache } from '../core/library/cache';
import { FakeLibrary, type AccessState } from '../core/library/port';
import { LibraryPalette } from './LibraryPalette';
import { useLibrary } from './useLibrary';

const tree = {
  'Bach/Inventions/Invention 1 in C major.musicxml': '<score-partwise/>',
  'Bach/Inventions/Invention 15 in B minor.musicxml': '<score-partwise/>',
  'Beethoven/Sonata 14.musicxml': '<score-partwise/>',
  'notes.txt': 'not a score',
};

function Harness({
  port,
  cache,
  onOpen,
  onClose,
}: {
  port: FakeLibrary;
  cache: MemoryCatalogCache;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const library = useLibrary(port, cache);
  return (
    <LibraryPalette
      library={library}
      onOpen={onOpen}
      onOpenFile={() => undefined}
      onClose={onClose}
    />
  );
}

function show(access: AccessState = 'granted') {
  const port = new FakeLibrary(tree, { access });
  const cache = new MemoryCatalogCache();
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<Harness port={port} cache={cache} onOpen={onOpen} onClose={onClose} />);
  return { port, cache, onOpen, onClose, user: userEvent.setup() };
}

async function listed() {
  await waitFor(() => {
    expect(screen.getAllByText('Invention 1 in C major').length).toBeGreaterThan(0);
  });
}

/** The row the arrows are currently on. */
function selected(): string {
  return screen.getByRole('option', { selected: true }).textContent ?? '';
}

describe('the library palette', () => {
  it('opens focused on the search box, so you can just type', async () => {
    show();
    await listed();

    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: /Find a piece/ }));
  });

  it('lists what it found, and nothing it cannot open', async () => {
    show();
    await listed();

    expect(screen.queryByText('notes')).toBeNull();
  });

  it('walks the list with the arrow keys', async () => {
    const { user } = show();
    await listed();
    const first = selected();

    await user.keyboard('{ArrowDown}');
    expect(selected()).not.toBe(first);

    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(first);
  });

  it('does not walk off either end of the list', async () => {
    const { user } = show();
    await listed();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    const top = selected();
    await user.keyboard('{ArrowDown}'.repeat(20));
    const bottom = selected();

    expect(top).not.toBe('');
    expect(bottom).not.toBe('');
  });

  it('opens the highlighted piece on Enter, and closes', async () => {
    const { user, onOpen, onClose } = show();
    await listed();

    await user.keyboard('sonata');
    await waitFor(() => {
      expect(selected()).toContain('Sonata 14');
    });
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledWith('Beethoven/Sonata 14.musicxml');
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the one you arrowed to, not the top match', async () => {
    const { user, onOpen } = show();
    await listed();

    await user.keyboard('invention');
    await waitFor(() => {
      expect(selected()).toContain('Invention');
    });
    const top = selected();
    await user.keyboard('{ArrowDown}');
    const second = selected();
    expect(second).not.toBe(top);
    await user.keyboard('{Enter}');

    // Whatever the ranking put second is what Enter must open — the assertion
    // is derived from the highlight rather than hard-coding a rank order.
    const opened = onOpen.mock.calls[0]?.[0] as string;
    expect(second).toContain(opened.slice(opened.lastIndexOf('/') + 1).replace('.musicxml', ''));
  });

  it('closes on Escape without opening anything', async () => {
    const { user, onOpen, onClose } = show();
    await listed();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('starts again from the top when the search changes', async () => {
    const { user } = show();
    await listed();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('a');

    await waitFor(() => {
      expect(screen.getByRole('option', { selected: true })).toBe(screen.getAllByRole('option')[0]);
    });
  });

  it('keeps the list usable while the folder is waiting to be reconnected', async () => {
    const { cache } = show('granted');
    await listed();

    const lapsed = new FakeLibrary(tree, { access: 'prompt' });
    render(<Harness port={lapsed} cache={cache} onOpen={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Reconnect/ }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Invention 1 in C major').length).toBeGreaterThan(0);
  });
});

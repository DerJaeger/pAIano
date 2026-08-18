import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rankPaths } from './fuzzy';

/** The matched substrings, so a test reads as what the UI would highlight. */
function highlights(path: string, query: string): string[] {
  const match = fuzzyMatch(query, path);
  return match ? match.ranges.map(([from, to]) => path.slice(from, to)) : [];
}

describe('fuzzyMatch', () => {
  it('matches a plain substring', () => {
    expect(fuzzyMatch('invention', 'Bach/Inventions/Invention 1.musicxml')).toBeDefined();
  });

  it('matches letters spread out, not just substrings', () => {
    // The point of the whole thing: initials and half-remembered spellings.
    expect(fuzzyMatch('bmin', 'Bach/Inventions/Invention 15 in B minor.musicxml')).toBeDefined();
  });

  it('takes several terms, each matched anywhere', () => {
    const path = 'Bach/Inventions/Invention 15 in B minor.musicxml';

    expect(fuzzyMatch('bmin inv', path)).toBeDefined();
    expect(fuzzyMatch('inv bmin', path)).toBeDefined();
  });

  it('rejects a term that is not there at all', () => {
    expect(fuzzyMatch('mozart', 'Bach/Inventions/Invention 1.musicxml')).toBeUndefined();
  });

  it('rejects letters that are there but out of order', () => {
    expect(fuzzyMatch('hcab', 'Bach.musicxml')).toBeUndefined();
  });

  it('ignores case', () => {
    expect(fuzzyMatch('BACH', 'bach/thing.musicxml')).toBeDefined();
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('   ', 'anything.musicxml')).toBeDefined();
  });

  it('reports where it matched, so the UI can highlight it', () => {
    expect(highlights('Bach/Invention.musicxml', 'inv')).toEqual(['Inv']);
  });

  it('reports one range per run, not one per letter', () => {
    expect(highlights('Chopin/Nocturne.musicxml', 'noct')).toEqual(['Noct']);
  });
});

describe('rankPaths', () => {
  const paths = [
    'Bach/Inventions/Invention 1 in C major.musicxml',
    'Bach/Inventions/Invention 15 in B minor.musicxml',
    'Beethoven/Sonata 14 in C sharp minor.musicxml',
    'current learning/Mad World.musicxml',
  ];

  it('finds the piece the plan promised it would', () => {
    const [best] = rankPaths('bmin inv', paths);

    expect(best?.path).toBe('Bach/Inventions/Invention 15 in B minor.musicxml');
  });

  it('leaves out what does not match', () => {
    expect(rankPaths('mozart', paths)).toEqual([]);
  });

  it('returns everything, in order, for an empty query', () => {
    expect(rankPaths('', paths).map((hit) => hit.path)).toEqual(paths);
  });

  it('prefers a match in the file name over one in the folder', () => {
    const [best] = rankPaths('sonata', paths);

    expect(best?.path).toBe('Beethoven/Sonata 14 in C sharp minor.musicxml');
  });

  it('prefers a run of letters over the same letters scattered', () => {
    const ranked = rankPaths('mad', [
      'Beethoven/Sonata 14 in C sharp minor.musicxml',
      'current learning/Mad World.musicxml',
    ]);

    expect(ranked[0]?.path).toBe('current learning/Mad World.musicxml');
  });

  it('prefers the start of a word', () => {
    const ranked = rankPaths('no', ['Chopin/Nocturne.musicxml', 'Chopin/Piano.musicxml']);

    expect(ranked[0]?.path).toBe('Chopin/Nocturne.musicxml');
  });
});

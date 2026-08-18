import { describe, expect, it } from 'vitest';
import { displayNameOf, folderOf, isScoreFile } from './scoreFiles';

describe('isScoreFile', () => {
  it('takes the three MusicXML spellings', () => {
    expect(isScoreFile('a.musicxml')).toBe(true);
    expect(isScoreFile('a.xml')).toBe(true);
    expect(isScoreFile('a.mxl')).toBe(true);
  });

  it('ignores case, because file systems do not agree about it', () => {
    expect(isScoreFile('A.MusicXML')).toBe(true);
  });

  it('leaves out what the app cannot open', () => {
    // .mid and .mscz are real things to find in a music folder, and listing a
    // piece that dead-ends when clicked is worse than not listing it.
    expect(isScoreFile('a.mid')).toBe(false);
    expect(isScoreFile('a.mscz')).toBe(false);
    expect(isScoreFile('a.pdf')).toBe(false);
    expect(isScoreFile('notes.txt')).toBe(false);
  });

  it('is not fooled by an extension in the middle of a name', () => {
    expect(isScoreFile('my.musicxml.backup')).toBe(false);
  });
});

describe('naming a piece', () => {
  const entry = { path: 'Bach/Invention 1.musicxml', modifiedAt: 0, size: 0 };

  it('prefers the title the score declares', () => {
    expect(displayNameOf({ ...entry, title: 'Invention No. 1' })).toBe('Invention No. 1');
  });

  it('falls back to the file name without its extension', () => {
    expect(displayNameOf(entry)).toBe('Invention 1');
  });

  it('names the folder a piece sits in, for the second line', () => {
    expect(folderOf('Bach/Inventions/Invention 1.musicxml')).toBe('Bach/Inventions');
    expect(folderOf('Invention 1.musicxml')).toBe('');
  });
});

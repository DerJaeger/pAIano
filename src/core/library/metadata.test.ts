import { describe, expect, it } from 'vitest';
import { readMetadata } from './metadata';

const wrap = (inner: string) =>
  `<?xml version="1.0"?><score-partwise version="3.1">${inner}</score-partwise>`;

describe('readMetadata', () => {
  it('reads the work title and the composer', () => {
    const meta = readMetadata(
      wrap(
        '<work><work-title>Invention No. 1</work-title></work>' +
          '<identification><creator type="composer">J.S. Bach</creator></identification>',
      ),
    );

    expect(meta).toEqual({ title: 'Invention No. 1', composer: 'J.S. Bach' });
  });

  it('falls back to the movement title', () => {
    expect(readMetadata(wrap('<movement-title>Allegro</movement-title>')).title).toBe('Allegro');
  });

  it('falls back to the credit MuseScore writes when there is no work title', () => {
    expect(
      readMetadata(wrap('<credit><credit-words>Mad World</credit-words></credit>')).title,
    ).toBe('Mad World');
  });

  it('picks the composer out of several creators', () => {
    const meta = readMetadata(
      wrap(
        '<identification>' +
          '<creator type="lyricist">Someone Else</creator>' +
          '<creator type="composer">Roland Orzabal</creator>' +
          '</identification>',
      ),
    );

    expect(meta.composer).toBe('Roland Orzabal');
  });

  it('says nothing rather than guessing when the file declares nothing', () => {
    expect(readMetadata(wrap('<part-list/>'))).toEqual({});
  });

  it('ignores blank declarations', () => {
    expect(readMetadata(wrap('<work><work-title>   </work-title></work>'))).toEqual({});
  });

  it('survives a file that is not MusicXML at all', () => {
    // The scan trusts file extensions, and an extension can lie. One bad file
    // must not take down the indexing of the other 83.
    expect(readMetadata('this is not xml <<<')).toEqual({});
  });
});

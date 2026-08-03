// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreSummary } from './ScoreSummary';
import { formatDuration, noteName } from './format';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import { attributes, note, score, tempo } from '../core/score/musicxml/fixtures';

const parsed = parseMusicXml(
  score([[tempo(60) + attributes(1) + note('C', 4, 4) + note('E', 4, 4)]], { title: 'Etude' }),
);

describe('ScoreSummary', () => {
  it('shows what the parser understood about the score', () => {
    render(<ScoreSummary score={parsed} />);
    expect(screen.getByRole('heading', { name: 'Etude' })).toBeDefined();
    expect(screen.getByText('60 bpm')).toBeDefined();
    expect(screen.getByText('0:08')).toBeDefined();
    expect(screen.getByText('C4')).toBeDefined();
    expect(screen.getByText('E4')).toBeDefined();
  });
});

describe('formatting helpers', () => {
  it('names MIDI notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(21)).toBe('A0');
    expect(noteName(61)).toBe('C♯4');
  });

  it('formats durations as minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(-1)).toBe('0:00');
  });
});

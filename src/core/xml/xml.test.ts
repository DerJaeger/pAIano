import { describe, expect, it } from 'vitest';
import {
  attr,
  child,
  childNumber,
  childText,
  children,
  childrenOf,
  descendants,
  has,
  nameOf,
  numAttr,
  parseXml,
  textOf,
} from './xml';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<measure number="1" width="120.5">
  <attributes><divisions>4</divisions></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
  <backup><duration>4</duration></backup>
  <note><pitch><step>E</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration></note>
</measure>`;

const measure = parseXml(DOC)[0]!;

describe('xml helpers', () => {
  it('exposes the element name and attributes', () => {
    expect(nameOf(measure)).toBe('measure');
    expect(attr(measure, 'number')).toBe('1');
    expect(numAttr(measure, 'width')).toBe(120.5);
    expect(attr(measure, 'nope')).toBeUndefined();
    expect(numAttr(measure, 'number')).toBe(1);
  });

  it('preserves document order across differently named siblings', () => {
    expect(childrenOf(measure).map(nameOf)).toEqual(['attributes', 'note', 'backup', 'note']);
  });

  it('reads text content and numbers', () => {
    const firstNote = child(measure, 'note')!;
    expect(childNumber(firstNote, 'duration')).toBe(4);
    expect(childText(child(firstNote, 'pitch')!, 'step')).toBe('C');
    expect(textOf(child(measure, 'attributes')!)).toBe('');
  });

  it('finds all same-named children, and reports presence', () => {
    expect(children(measure, 'note')).toHaveLength(2);
    expect(has(measure, 'backup')).toBe(true);
    expect(has(measure, 'forward')).toBe(false);
  });

  it('finds nested descendants in document order', () => {
    expect(descendants(measure, 'step').map(textOf)).toEqual(['C', 'E']);
    expect(descendants(measure, 'duration').map(textOf)).toEqual(['4', '4', '2']);
  });

  it('treats a missing or empty number as undefined rather than NaN', () => {
    const doc = parseXml('<a><b></b><c>x</c></a>')[0]!;
    expect(childNumber(doc, 'b')).toBeUndefined();
    expect(childNumber(doc, 'c')).toBeUndefined();
    expect(childNumber(doc, 'missing')).toBeUndefined();
  });
});

/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSetting, writeSetting } from './settings';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('settings', () => {
  it('reads back what it wrote', () => {
    writeSetting('guideAudible', false);

    expect(readSetting('guideAudible', true)).toBe(false);
  });

  it('falls back when nothing was ever written', () => {
    expect(readSetting('guideAudible', true)).toBe(true);
  });

  it('namespaces its keys, so it cannot collide with another app on the origin', () => {
    writeSetting('guideAudible', false);

    expect(localStorage.getItem('guideAudible')).toBeNull();
    expect(localStorage.key(0)).toContain('pianobooster');
  });

  it('falls back rather than throwing on a value it cannot parse', () => {
    writeSetting('guideAudible', false);
    localStorage.setItem(localStorage.key(0)!, 'not json');

    expect(readSetting('guideAudible', true)).toBe(true);
  });

  it('survives storage being unavailable', () => {
    // Private-mode Firefox and a blocked third-party context both throw here,
    // and a preference is never worth taking the app down for.
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => {
      writeSetting('guideAudible', false);
    }).not.toThrow();
    expect(readSetting('guideAudible', true)).toBe(true);
  });
});

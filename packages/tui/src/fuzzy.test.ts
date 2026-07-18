import { describe, it, expect } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from './fuzzy.js';

describe('fuzzyMatch', () => {
  it('returns empty matches for an empty query (everything matches with no highlights)', () => {
    expect(fuzzyMatch('Alfie Granger', '')).toEqual([]);
  });

  it('matches the query chars in order, returning their indices in the label', () => {
    expect(fuzzyMatch('Alfie Granger', 'agr')).toEqual([0, 6, 7]);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('Alfie', 'ALF')).toEqual([0, 1, 2]);
  });

  it('returns null when any query char cannot be matched in order', () => {
    expect(fuzzyMatch('Alfie', 'az')).toBeNull();
    expect(fuzzyMatch('abc', 'cb')).toBeNull();
  });

  it('does not reuse a label index for two different query chars', () => {
    expect(fuzzyMatch('aaa', 'aa')).toEqual([0, 1]);
  });
});

describe('fuzzyFilter', () => {
  const opts = [
    { id: '1', label: 'Alfie Granger' },
    { id: '2', label: 'Thomas Lam' },
    { id: '3', label: 'Mira Chen' },
  ];

  it('keeps all options for an empty query, with empty match arrays', () => {
    const out = fuzzyFilter(opts, '');
    expect(out.map((h) => h.option.id)).toEqual(['1', '2', '3']);
    expect(out.every((h) => h.matches.length === 0)).toBe(true);
  });

  it('drops options that do not match', () => {
    expect(fuzzyFilter(opts, 'alf').map((h) => h.option.id)).toEqual(['1']);
    expect(fuzzyFilter(opts, 'mc').map((h) => h.option.id)).toEqual(['3']);
  });

  it('returns the match indices per option', () => {
    const out = fuzzyFilter(opts, 'tl');
    expect(out).toEqual([{ option: opts[1], matches: [0, 7] }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(fuzzyFilter(opts, 'zzz')).toEqual([]);
  });
});

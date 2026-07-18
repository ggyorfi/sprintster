import { describe, it, expect } from 'vitest';
import { sanitizeFieldInput } from './field-sanitize.js';

describe('sanitizeFieldInput', () => {
  it('keeps only digits for integers', () => {
    expect(sanitizeFieldInput('integer', '1a2b3')).toBe('123');
  });

  it('allows one dot and at most two decimals for money', () => {
    expect(sanitizeFieldInput('money', '50.5')).toBe('50.5');
    expect(sanitizeFieldInput('money', '50.567')).toBe('50.56');
    expect(sanitizeFieldInput('money', '5.0.0')).toBe('5.00');
    expect(sanitizeFieldInput('money', '£50')).toBe('50');
  });

  it('allows digits and dashes for dates, capped at 10 chars', () => {
    expect(sanitizeFieldInput('date', '2026/05/26')).toBe('20260526');
    expect(sanitizeFieldInput('date', '2026-05-26extra')).toBe('2026-05-26');
  });

  it('passes text through untouched', () => {
    expect(sanitizeFieldInput('text', 'hello, world')).toBe('hello, world');
  });
});

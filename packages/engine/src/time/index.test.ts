import { describe, it, expect } from 'vitest';
import { nowAsIso, parseIso, IsoInstant, IsoInstantToDate, formatIsoMinute } from './index.js';

describe('nowAsIso', () => {
  it('returns a string that parses back to a valid Date close to "now"', () => {
    const before = Date.now();
    const iso = nowAsIso();
    const after = Date.now();
    const parsed = parseIso(iso);
    const t = parsed.getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('produces a UTC ISO-8601 string ending in Z', () => {
    expect(nowAsIso()).toMatch(/Z$/);
  });
});

describe('parseIso', () => {
  it('parses a valid ISO string', () => {
    const d = parseIso('2026-05-21T20:49:52.425Z');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4);
    expect(d.getUTCDate()).toBe(21);
  });

  it('parses with timezone offsets', () => {
    const d = parseIso('2026-05-21T22:49:52.425+02:00');
    expect(d.getUTCHours()).toBe(20);
  });

  it('rejects garbage input', () => {
    expect(() => parseIso('not a date')).toThrow(/invalid ISO date/);
    expect(() => parseIso('')).toThrow(/invalid ISO date/);
  });
});

describe('IsoInstant Zod schema', () => {
  it('accepts a UTC ISO string', () => {
    expect(IsoInstant.parse('2026-05-21T20:49:52.425Z')).toBe('2026-05-21T20:49:52.425Z');
  });

  it('accepts ISO with offset', () => {
    expect(IsoInstant.parse('2026-05-21T22:49:52.425+02:00')).toBe('2026-05-21T22:49:52.425+02:00');
  });

  it('rejects non-ISO strings', () => {
    expect(() => IsoInstant.parse('2026-05-21')).toThrow();
    expect(() => IsoInstant.parse('hello')).toThrow();
  });
});

describe('IsoInstantToDate Zod schema', () => {
  it('parses an ISO string into a Date', () => {
    const d = IsoInstantToDate.parse('2026-05-21T20:49:52.425Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2026);
  });
});

describe('formatIsoMinute', () => {
  it('renders a compact UTC date and time to the minute', () => {
    expect(formatIsoMinute('2026-07-18T14:30:52.425Z')).toBe('2026-07-18 14:30');
  });

  it('normalises an offset to UTC', () => {
    expect(formatIsoMinute('2026-07-18T16:30:00+02:00')).toBe('2026-07-18 14:30');
  });

  it('zero-pads month, day, hour, and minute', () => {
    expect(formatIsoMinute('2026-01-05T04:07:00Z')).toBe('2026-01-05 04:07');
  });

  it('throws on garbage input', () => {
    expect(() => formatIsoMinute('not a date')).toThrow(/invalid ISO date/);
  });
});

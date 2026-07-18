import { describe, it, expect } from 'vitest';
import {
  fromPence,
  zeroGBP,
  toPence,
  toPenceString,
  formatGBP,
  PenceString,
  MoneyFromPenceString,
  add,
  subtract,
  multiply,
  equal,
  isPositive,
  isNegative,
  isZero,
} from './index.js';

describe('fromPence / toPence', () => {
  it('round-trips an integer through number input', () => {
    expect(toPence(fromPence(12500))).toBe(12500);
  });

  it('round-trips through string input', () => {
    expect(toPence(fromPence('12500'))).toBe(12500);
  });

  it('accepts zero', () => {
    expect(toPence(fromPence(0))).toBe(0);
  });

  it('accepts negative pence', () => {
    expect(toPence(fromPence(-500))).toBe(-500);
    expect(toPence(fromPence('-500'))).toBe(-500);
  });

  it('rejects non-integer numbers', () => {
    expect(() => fromPence(12.5)).toThrow(/integer/);
  });

  it('rejects strings that are not pure digits', () => {
    expect(() => fromPence('12.50')).toThrow(/invalid pence string/);
    expect(() => fromPence('£125')).toThrow(/invalid pence string/);
    expect(() => fromPence('')).toThrow(/invalid pence string/);
  });
});

describe('zeroGBP', () => {
  it('returns a zero-amount GBP money', () => {
    const z = zeroGBP();
    expect(toPence(z)).toBe(0);
    expect(isZero(z)).toBe(true);
  });
});

describe('toPenceString', () => {
  it('serialises money as a digit string suitable for JSONB', () => {
    expect(toPenceString(fromPence(12500))).toBe('12500');
    expect(toPenceString(fromPence(0))).toBe('0');
    expect(toPenceString(fromPence(-500))).toBe('-500');
  });
});

describe('formatGBP', () => {
  it('formats with a pound sign and two decimal places', () => {
    expect(formatGBP(fromPence(12500))).toBe('£125.00');
    expect(formatGBP(fromPence(50))).toBe('£0.50');
    expect(formatGBP(fromPence(0))).toBe('£0.00');
  });
});

describe('arithmetic', () => {
  it('add preserves precision', () => {
    const result = add(fromPence(10), fromPence(20));
    expect(toPence(result)).toBe(30);
  });

  it('subtract preserves precision', () => {
    const result = subtract(fromPence(100), fromPence(33));
    expect(toPence(result)).toBe(67);
  });

  it('multiply by a scalar', () => {
    const result = multiply(fromPence(2500), 4);
    expect(toPence(result)).toBe(10000);
  });

  it('equal compares value', () => {
    expect(equal(fromPence(500), fromPence(500))).toBe(true);
    expect(equal(fromPence(500), fromPence(501))).toBe(false);
  });

  it('isPositive / isNegative / isZero', () => {
    expect(isPositive(fromPence(1))).toBe(true);
    expect(isNegative(fromPence(-1))).toBe(true);
    expect(isZero(fromPence(0))).toBe(true);
    expect(isPositive(fromPence(0))).toBe(false);
  });
});

describe('PenceString Zod schema', () => {
  it('accepts pure-digit strings (positive and negative)', () => {
    expect(PenceString.parse('12500')).toBe('12500');
    expect(PenceString.parse('0')).toBe('0');
    expect(PenceString.parse('-500')).toBe('-500');
  });

  it('rejects decimal, formatted, or empty strings', () => {
    expect(() => PenceString.parse('12.50')).toThrow();
    expect(() => PenceString.parse('£125')).toThrow();
    expect(() => PenceString.parse('')).toThrow();
  });
});

describe('MoneyFromPenceString Zod schema', () => {
  it('parses a pence string into a Money', () => {
    const m = MoneyFromPenceString.parse('12500');
    expect(toPence(m)).toBe(12500);
  });

  it('rejects invalid strings', () => {
    expect(() => MoneyFromPenceString.parse('abc')).toThrow();
  });
});

import {
  dinero,
  toSnapshot,
  toDecimal,
  add as dineroAdd,
  subtract as dineroSubtract,
  multiply as dineroMultiply,
  equal as dineroEqual,
  isPositive as dineroIsPositive,
  isNegative as dineroIsNegative,
  isZero as dineroIsZero,
  type Dinero,
} from 'dinero.js';
import { GBP } from '@dinero.js/currencies';
import { z } from 'zod';

export { GBP };

export type Money = Dinero<number>;

const PENCE_STRING_RE = /^-?\d+$/;

export function fromPence(pence: number | string): Money {
  const amount = typeof pence === 'string' ? parsePenceString(pence) : pence;
  if (!Number.isInteger(amount)) {
    throw new Error(`pence must be an integer, got ${String(amount)}`);
  }
  return dinero({ amount, currency: GBP });
}

export function zeroGBP(): Money {
  return dinero({ amount: 0, currency: GBP });
}

export function toPence(money: Money): number {
  return toSnapshot(money).amount;
}

export function toPenceString(money: Money): string {
  return String(toPence(money));
}

export function formatGBP(money: Money): string {
  return toDecimal(money, ({ value }) => `£${value}`);
}

function parsePenceString(s: string): number {
  if (!PENCE_STRING_RE.test(s)) {
    throw new Error(`invalid pence string: ${JSON.stringify(s)}`);
  }
  return Number.parseInt(s, 10);
}

export const PenceString = z.string().regex(PENCE_STRING_RE);

export const MoneyFromPenceString = PenceString.transform((s) => fromPence(s));

export const add = dineroAdd;
export const subtract = dineroSubtract;
export const multiply = dineroMultiply;
export const equal = dineroEqual;
export const isPositive = dineroIsPositive;
export const isNegative = dineroIsNegative;
export const isZero = dineroIsZero;

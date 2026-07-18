import { z } from 'zod';

export function nowAsIso(): string {
  return new Date().toISOString();
}

export function parseIso(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid ISO date: ${JSON.stringify(s)}`);
  }
  return d;
}

export const IsoInstant = z.string().datetime({ offset: true });

export const IsoInstantToDate = IsoInstant.transform((s) => parseIso(s));

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

// Compact UTC display for list cells: `YYYY-MM-DD HH:MM`, which also sorts lexically.
export function formatIsoMinute(s: string): string {
  const d = parseIso(s);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

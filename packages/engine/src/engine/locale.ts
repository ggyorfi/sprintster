import { appConfig } from '../config/app-config.js';
import type { PropertyConfig } from '../config/schema.js';

export function isTranslated(property: PropertyConfig): boolean {
  return (property.type === 'text' || property.type === 'markdown') && property.translated === true;
}

// A form keeps one input per locale for a translated field, under this key.
export function localeInputKey(path: string, locale: string): string {
  return `${path}@${locale}`;
}

// Plain values pass through; a translated value gives its text in `locale`, falling back to the default locale.
export function displayText(value: unknown, locale?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return String(value);
  const map = value as Record<string, unknown>;
  for (const l of [locale, appConfig.locales?.[0]]) {
    const text = l === undefined ? undefined : map[l];
    if (typeof text === 'string' && text !== '') return text;
  }
  return '';
}

export function translatedInputs(path: string, value: unknown): Record<string, string> {
  const map = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const locale of appConfig.locales ?? []) {
    const text = map[locale];
    out[localeInputKey(path, locale)] = typeof text === 'string' ? text : '';
  }
  return out;
}

// Empty locales are left out, so a missing translation falls back rather than showing blank.
export function assembleTranslated(path: string, inputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of appConfig.locales ?? []) {
    const text = (inputs[localeInputKey(path, locale)] ?? '').trim();
    if (text !== '') out[locale] = text;
  }
  return out;
}

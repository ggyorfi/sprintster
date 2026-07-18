import { describe, it, expect } from 'vitest';
import { resolveApiBaseUrl } from './config.js';

describe('resolveApiBaseUrl', () => {
  it('defaults to same-origin (empty base) so the daemon-hosted bundle talks to itself', () => {
    expect(resolveApiBaseUrl({})).toBe('');
  });

  it('uses VITE_API_URL when set, so a cloud build can target a remote daemon', () => {
    expect(resolveApiBaseUrl({ VITE_API_URL: 'https://app.example.com' })).toBe('https://app.example.com');
  });

  it('honours an explicit /api base for the Vite dev proxy', () => {
    expect(resolveApiBaseUrl({ VITE_API_URL: '/api' })).toBe('/api');
  });
});

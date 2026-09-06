import { describe, it, expect } from 'vitest';
import { appRootFrom, resolveApiBaseUrl } from './config.js';

describe('appRootFrom', () => {
  it('is the origin when the bundle sits at the root, so the daemon-hosted bundle talks to itself', () => {
    expect(appRootFrom('http://127.0.0.1:3939/_app/index-abc.js')).toBe('http://127.0.0.1:3939');
    expect(appRootFrom('https://admin.example.com/_app/index-abc.js')).toBe('https://admin.example.com');
  });

  it('is the mount point when the shell is served under a prefix', () => {
    expect(appRootFrom('http://localhost:4000/admin/_app/index-abc.js')).toBe('http://localhost:4000/admin');
  });

  it('is empty outside a built bundle (dev server, tests)', () => {
    expect(appRootFrom('http://localhost:5173/src/api/config.ts')).toBe('');
    expect(appRootFrom('file:///repo/packages/web/src/api/config.ts')).toBe('');
  });
});

describe('resolveApiBaseUrl', () => {
  it('follows the mount point when VITE_API_URL is unset', () => {
    expect(resolveApiBaseUrl({}, 'http://localhost:4000/admin/_app/index-abc.js')).toBe('http://localhost:4000/admin');
    expect(resolveApiBaseUrl({}, 'http://127.0.0.1:3939/_app/index-abc.js')).toBe('http://127.0.0.1:3939');
  });

  it('uses VITE_API_URL when set, so a cloud build can target a remote daemon', () => {
    expect(resolveApiBaseUrl({ VITE_API_URL: 'https://app.example.com' }, 'http://x/admin/_app/i.js')).toBe(
      'https://app.example.com',
    );
  });

  it('honours an explicit /api base for the Vite dev proxy', () => {
    expect(resolveApiBaseUrl({ VITE_API_URL: '/api' }, 'http://localhost:5173/src/api/config.ts')).toBe('/api');
  });
});

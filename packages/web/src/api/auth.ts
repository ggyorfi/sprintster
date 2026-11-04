import type { AuthConfig } from '@sprintster/engine';
import { resolveApiBaseUrl } from './config.js';

// The host checks credentials (ADR 14); this module only calls its routes and notices when a session is gone.
let paths: AuthConfig | undefined;
let signedOut = false;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAuth(auth: AuthConfig | undefined): void {
  paths = auth;
}

export function authEnabled(): boolean {
  return paths !== undefined;
}

export function needsLogin(): boolean {
  return signedOut;
}

export function onSignedOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function signOut(): void {
  signedOut = true;
  for (const listener of listeners) listener();
}

const authUrl = (path: string, baseUrl: string) => `${baseUrl}${path}`;

// Concurrent 401s share one call, so a host whose refresh tokens are single use never sees one twice.
function refresh(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (paths === undefined) return Promise.resolve(false);
  const url = authUrl(paths.refresh, baseUrl);
  refreshing ??= fetchImpl(url, { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function createAuthFetch(fetchImpl: typeof fetch = fetch, baseUrl: string = resolveApiBaseUrl()): typeof fetch {
  return async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status !== 401 || paths === undefined) return res;
    if (await refresh(baseUrl, fetchImpl)) {
      const retried = await fetchImpl(input, init);
      if (retried.status !== 401) return retried;
    }
    signOut();
    return res;
  };
}

export const authFetch: typeof fetch = (input, init) => createAuthFetch(fetch)(input, init);

export async function logIn(username: string, password: string, baseUrl: string = resolveApiBaseUrl(), fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (paths === undefined) return null;
  try {
    const res = await fetchImpl(authUrl(paths.login, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      signedOut = false;
      return null;
    }
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return body?.message ?? 'Wrong username or password.';
  } catch {
    return 'Cannot reach the server.';
  }
}

export async function logOut(baseUrl: string = resolveApiBaseUrl(), fetchImpl: typeof fetch = fetch): Promise<void> {
  if (paths !== undefined) await fetchImpl(authUrl(paths.logout, baseUrl), { method: 'POST' }).catch(() => undefined);
  signOut();
}

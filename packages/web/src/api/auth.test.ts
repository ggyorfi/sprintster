import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthFetch, logIn, logOut, needsLogin, onSignedOut, setAuth } from './auth.js';

const auth = { login: '/_auth/login', logout: '/_auth/logout', refresh: '/_auth/refresh' };

// Answers 401 to API calls until a refresh succeeds, counting the refresh calls.
function host(refreshOk: boolean) {
  let valid = false;
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/_auth/refresh')) {
      await new Promise((r) => setTimeout(r, 5));
      valid = refreshOk;
      return new Response(null, { status: refreshOk ? 204 : 401 });
    }
    if (url.endsWith('/_auth/login')) return new Response(null, { status: 204 });
    if (url.endsWith('/_auth/logout')) return new Response(null, { status: 204 });
    return new Response('{}', { status: valid ? 200 : 401 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

afterEach(() => setAuth(undefined));

describe('authFetch', () => {
  it('passes a 401 through untouched when the app has no auth', async () => {
    const { fetchImpl, calls } = host(true);
    const res = await createAuthFetch(fetchImpl, '')('/notes');
    expect(res.status).toBe(401);
    expect(calls).toEqual(['/notes']);
  });

  it('refreshes once for concurrent 401s and retries each request', async () => {
    setAuth(auth);
    const { fetchImpl, calls } = host(true);
    const f = createAuthFetch(fetchImpl, '');
    const results = await Promise.all([f('/notes'), f('/config')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(calls.filter((c) => c === '/_auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh is refused', async () => {
    setAuth(auth);
    const { fetchImpl } = host(false);
    const listener = vi.fn();
    const off = onSignedOut(listener);
    const res = await createAuthFetch(fetchImpl, '')('/notes');
    off();
    expect(res.status).toBe(401);
    expect(listener).toHaveBeenCalledOnce();
    expect(needsLogin()).toBe(true);
  });
});

describe('logIn and logOut', () => {
  it('posts the credentials as JSON and clears the signed out state', async () => {
    setAuth(auth);
    const { fetchImpl } = host(false);
    await logOut('', fetchImpl);
    expect(needsLogin()).toBe(true);
    expect(await logIn('anna', 'secret', '', fetchImpl)).toBeNull();
    expect(needsLogin()).toBe(false);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => u === '/_auth/login')!;
    expect(JSON.parse(String(init.body))).toEqual({ username: 'anna', password: 'secret' });
  });

  it('shows the host message on a refusal', async () => {
    setAuth(auth);
    const fetchImpl = (async () => Response.json({ message: 'Too many attempts.' }, { status: 429 })) as typeof fetch;
    expect(await logIn('anna', 'x', '', fetchImpl)).toBe('Too many attempts.');
  });
});

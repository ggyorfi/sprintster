import { useCallback, useEffect, useState } from 'react';
import { appConfig } from '@sprintster/engine';
import { applyConfigTheme } from '../theme/applyConfigTheme.js';
import { resolveApiBaseUrl } from '../api/config.js';
import { needsLogin, onSignedOut, setAuth } from '../api/auth.js';
import { loadServerConfig } from './bootstrap.js';
import { fetchHealth } from './health.js';
import { App, appTitle } from './App.js';
import { Login } from './Login.js';

type Phase = 'loading' | 'login' | 'app';

export function Root() {
  const [phase, setPhase] = useState<Phase>('loading');
  // Remounts the app after a login, so nothing loaded under the previous session survives.
  const [session, setSession] = useState(0);

  const start = useCallback(async () => {
    const baseUrl = resolveApiBaseUrl();
    setAuth((await fetchHealth(baseUrl).catch(() => null))?.auth);
    await loadServerConfig(baseUrl);
    if (needsLogin()) {
      setPhase('login');
      return;
    }
    applyConfigTheme(appConfig.theme as Record<string, string | undefined>);
    document.title = appTitle();
    setSession((s) => s + 1);
    setPhase('app');
  }, []);

  useEffect(() => onSignedOut(() => setPhase('login')), []);
  useEffect(() => void start(), [start]);

  if (phase === 'login') return <Login onLoggedIn={() => void start()} />;
  if (phase === 'app') return <App key={session} />;
  return null;
}

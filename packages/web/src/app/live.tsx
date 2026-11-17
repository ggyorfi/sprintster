import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { liveUrl, watchLog } from '@sprintster/engine';
import { authFetch } from '../api/auth.js';

export interface Live {
  // Grows whenever the log moved; what shows server state reloads when it does.
  tick: number;
  connected: boolean | null;
}

const LiveContext = createContext<Live>({ tick: 0, connected: null });

export const useLive = (): Live => useContext(LiveContext);

// ADR 28: one socket per tab. A hidden tab neither reconnects nor reloads; it reloads once when shown if the log moved meanwhile.
export function LiveProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let missed = false;
    const bump = () => setTick((t) => t + 1);
    const watch = watchLog(liveUrl(baseUrl, window.location.href), {
      onChange: () => (document.hidden ? (missed = true) : bump()),
      onConnected: setConnected,
      beforeRetry: () => authFetch(`${baseUrl}/config`),
    });
    const onVisibility = () => {
      watch.hold(document.hidden);
      if (!document.hidden && missed) {
        missed = false;
        bump();
      }
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      watch.close();
    };
  }, [baseUrl]);

  return <LiveContext.Provider value={{ tick, connected }}>{children}</LiveContext.Provider>;
}

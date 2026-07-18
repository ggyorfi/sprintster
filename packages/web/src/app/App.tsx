import { useEffect, useMemo, useState } from 'react';
import { appConfig, version, type ObjectConfig } from '@sprintster/engine';
import { resolveApiBaseUrl } from '../api/config.js';
import { createWebApiClient } from '../api/client.js';
import { makeResolveObject, ObjectScreen } from '../engine/index.js';
import { StatusBar } from './StatusBar.js';
import { Maintenance } from './Maintenance.js';
import styles from './App.module.css';

const MAINTENANCE = '__maintenance__';

function readCtx(objects: ReadonlyArray<ObjectConfig>): string {
  const ctx = new URLSearchParams(window.location.search).get('ctx');
  if (ctx === MAINTENANCE) return ctx;
  if (ctx !== null && objects.some((o) => o.name === ctx)) return ctx;
  return objects[0]?.name ?? MAINTENANCE;
}

export function App() {
  const baseUrl = useMemo(() => resolveApiBaseUrl(), []);
  const api = useMemo(() => createWebApiClient({ baseUrl }), [baseUrl]);
  const resolveObject = useMemo(() => makeResolveObject(), []);
  const objects = appConfig.objects;
  const [ctx, setCtx] = useState<string>(() => readCtx(objects));

  useEffect(() => {
    const onPop = () => setCtx(readCtx(objects));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [objects]);

  function navigate(next: string) {
    const params = new URLSearchParams(window.location.search);
    params.set('ctx', next);
    window.history.pushState(null, '', `?${params.toString()}`);
    setCtx(next);
  }

  const activeObj = objects.find((o) => o.name === ctx) ?? null;

  return (
    <div className={styles.app}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.logo}>T</span> Tutor CRM
        </div>
        <nav className={styles.nav}>
          {objects.map((o) => (
            <button
              key={o.name}
              type="button"
              className={[styles.navItem, ctx === o.name && styles.active].filter(Boolean).join(' ')}
              onClick={() => navigate(o.name)}
            >
              {o.titlePlural}
            </button>
          ))}
          <button
            type="button"
            className={[styles.navItem, ctx === MAINTENANCE && styles.active].filter(Boolean).join(' ')}
            onClick={() => navigate(MAINTENANCE)}
          >
            Maintenance
          </button>
        </nav>
      </aside>
      <div className={styles.main}>
        <div className={styles.content}>
          {activeObj !== null ? (
            <ObjectScreen key={activeObj.name} api={api} obj={activeObj} resolveObject={resolveObject} />
          ) : (
            <Maintenance baseUrl={baseUrl} />
          )}
        </div>
        <StatusBar baseUrl={baseUrl} version={version} />
      </div>
    </div>
  );
}

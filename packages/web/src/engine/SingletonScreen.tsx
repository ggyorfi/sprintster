import { useCallback, useEffect, useState } from 'react';
import {
  assembleValues,
  singletonId,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
} from '@sprintster/engine';
import { Button } from '../ui/index.js';
import { ObjectFields, useObjectForm } from './ObjectForm.js';
import { formatError, type Row } from './resolve.js';
import styles from './ObjectScreen.module.css';

export interface SingletonScreenProps {
  api: ApiClient;
  obj: ObjectConfig;
  resolveObject: ObjectResolver;
}

export function SingletonScreen({ api, obj, resolveObject }: SingletonScreenProps) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRow(await api.object<Row>(obj.name).get(singletonId(obj)));
    } catch (err) {
      setLoadError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [api, obj]);

  useEffect(() => {
    void load();
  }, [load]);

  const form = useObjectForm(api, obj, resolveObject, 'edit', row);
  const { viewName, inputs, error, setError, busy, setBusy } = form;

  function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    void (async () => {
      try {
        const assembled = assembleValues(obj, viewName, inputs, 'edit');
        await api.object(obj.name).update(singletonId(obj), assembled);
        await load();
        setSaved(true);
      } catch (e) {
        setError(formatError(e));
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{obj.titlePlural}</h1>
        <div className={styles.tools}>
          <Button variant="primary" disabled={busy || loading} onClick={save}>
            Save
          </Button>
        </div>
      </div>

      {loadError !== null && <div className={styles.error}>{loadError}</div>}
      {error !== null && <div className={styles.error}>{error}</div>}
      {saved && error === null && <div className={styles.muted}>Saved.</div>}

      {loading ? <div className={styles.muted}>Loading {obj.title.toLowerCase()}...</div> : <ObjectFields form={form} />}
    </div>
  );
}

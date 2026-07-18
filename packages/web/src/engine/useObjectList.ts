import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, ObjectConfig, ObjectResolver } from '@sprintster/engine';
import { enrichRefColumns, formatError, type Row } from './resolve.js';

export interface ListState {
  rows: Row[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useObjectList(api: ApiClient, obj: ObjectConfig, resolveObject: ObjectResolver): ListState {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await api.object<Row>(obj.name).list();
      setRows(await enrichRefColumns(api, obj, resolveObject, fetched));
    } catch (err) {
      setRows([]);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [api, obj, resolveObject]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, refetch: load };
}

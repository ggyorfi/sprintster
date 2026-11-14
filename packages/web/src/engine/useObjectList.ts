import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listFields, type ApiClient, type ObjectConfig, type ObjectResolver } from '@sprintster/engine';
import { formatError, type Row } from './resolve.js';

export const LIST_PAGE = 100;
// Pages are asked for once scrolling pauses this long, so pages flown past are never fetched.
export const SCROLL_SETTLE_MS = 300;

export interface ListState {
  // Every record the search matches; null until the first page answers.
  total: number | null;
  // The row at a position, undefined while its page is not loaded.
  rowAt: (index: number) => Row | undefined;
  loading: boolean;
  error: string | null;
  // Asks for the pages holding these positions, end exclusive.
  show: (start: number, end: number) => void;
  refetch: () => Promise<void>;
}

// ADR 24: the list as a fixed number of rows, each page fetched by offset when it comes into view.
export function useObjectList(api: ApiClient, obj: ObjectConfig, resolveObject: ObjectResolver, query = '', filter: readonly string[] = []): ListState {
  const fields = useMemo(() => listFields(obj, 'default', resolveObject), [obj, resolveObject]);
  const [pages, setPages] = useState<ReadonlyMap<number, Row[]>>(new Map());
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A newer search or reload makes the pages in flight stale.
  const generation = useRef(0);
  const asked = useRef(new Set<number>());
  const wanted = useRef<{ start: number; end: number } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const q = query.trim();
  const filterKey = filter.join('\u0000');

  const fetchPage = useCallback(
    async (index: number, count: boolean) => {
      const mine = generation.current;
      asked.current.add(index);
      try {
        const chosen = filterKey === '' ? [] : filterKey.split('\u0000');
        const page = await api.object<Row>(obj.name).page({
          fields,
          limit: LIST_PAGE,
          offset: index * LIST_PAGE,
          ...(count ? {} : { count: false }),
          ...(q === '' ? {} : { q }),
          ...(chosen.length === 0 ? {} : { filter: chosen }),
        });
        if (mine !== generation.current) return;
        setPages((p) => new Map(p).set(index, page.rows));
        if (count) setTotal(page.total ?? page.rows.length);
      } catch (err) {
        if (mine !== generation.current) return;
        asked.current.delete(index);
        setError(formatError(err));
      }
    },
    [api, obj, fields, q, filterKey],
  );

  const load = useCallback(async () => {
    generation.current++;
    asked.current = new Set();
    clearTimeout(settle.current);
    setPages(new Map());
    setTotal(null);
    setError(null);
    setLoading(true);
    await fetchPage(0, true);
    setLoading(false);
  }, [fetchPage]);

  const fetchWanted = useCallback(() => {
    const range = wanted.current;
    if (range === null || total === null) return;
    const last = Math.min(range.end, total) - 1;
    for (let i = Math.floor(range.start / LIST_PAGE); i <= Math.floor(last / LIST_PAGE); i++) {
      if (!asked.current.has(i)) void fetchPage(i, false);
    }
  }, [fetchPage, total]);

  const show = useCallback(
    (start: number, end: number) => {
      wanted.current = { start, end };
      clearTimeout(settle.current);
      settle.current = setTimeout(fetchWanted, SCROLL_SETTLE_MS);
    },
    [fetchWanted],
  );

  useEffect(() => {
    void load();
    return () => clearTimeout(settle.current);
  }, [load]);

  useEffect(() => {
    fetchWanted();
  }, [fetchWanted]);

  const rowAt = useCallback((index: number) => pages.get(Math.floor(index / LIST_PAGE))?.[index % LIST_PAGE], [pages]);

  return { total, rowAt, loading, error, show, refetch: load };
}

import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import {
  columnsFor,
  listColumns,
  recordExtensions,
  lifecycleInfo,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewMode,
} from '@sprintster/engine';
import { Table, SearchBar, Button, EmptyState, Pill, type Column, type PillTone } from '../ui/index.js';
import { serverExtensions } from '../app/bootstrap.js';
import { RecordAction } from '../app/RecordAction.js';
import { resolveApiBaseUrl } from '../api/config.js';
import { useObjectList } from './useObjectList.js';
import { renderCell } from './cells.js';
import { ObjectPanel } from './ObjectPanel.js';
import { SingletonScreen } from './SingletonScreen.js';
import type { Row } from './resolve.js';
import styles from './ObjectScreen.module.css';

export interface ObjectScreenProps {
  api: ApiClient;
  obj: ObjectConfig;
  resolveObject: ObjectResolver;
}

export function ObjectScreen(props: ObjectScreenProps) {
  if (props.obj.singleton === true) return <SingletonScreen {...props} />;
  return <ListScreen {...props} />;
}

const SEARCH_DELAY_MS = 250;
const SKELETON = '__skeleton-';
const OVERSCAN = 15;

function ListScreen({ api, obj, resolveObject }: ObjectScreenProps) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const filterGroups = obj.lists[0]?.filters ?? [];
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const filter = useMemo(() => Object.entries(chosen).map(([group, option]) => `${group}:${option}`), [chosen]);
  const { total, rowAt, loading, error, show, refetch } = useObjectList(api, obj, resolveObject, searched, filter);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const [panel, setPanel] = useState<{ mode: ViewMode; row: Row | null } | null>(null);
  const [reply, setReply] = useState<{ text: string; failed: boolean } | null>(null);
  const pluginColumns = useMemo(() => columnsFor(serverExtensions, obj.name), [obj]);
  const rowActions = useMemo(() => recordExtensions(serverExtensions, obj.name).actions.filter((a) => a.inList === true), [obj]);

  const cols = useMemo(() => listColumns(obj, 'default', resolveObject), [obj, resolveObject]);
  const lifecycle = useMemo(() => lifecycleInfo(obj), [obj]);
  const search = obj.lists[0]?.search;
  const actions = obj.lists[0]?.actions ?? [];
  const canCreate = actions.some((a) => a.kind === 'create');
  const canEditObj = actions.some((a) => a.kind === 'edit');
  const canViewObj = actions.some((a) => a.kind === 'view');

  const rowHeight = cols.some((c) => c.thumbnail) ? 68 : 41;
  const count = total ?? 0;
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(count, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
  const positions = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  const visible = positions.map(rowAt).filter((r): r is Row => r !== undefined);

  useEffect(() => {
    show(start, end);
  }, [show, start, end]);

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
    setView((v) => ({ top: 0, height: scroller.current?.clientHeight || v.height }));
  }, [searched, filter, loading]);

  // ADR 27: one switch per filter group; All clears the group.
  const choose = (group: string, option: string | null) =>
    setChosen((c) => {
      const next = { ...c };
      if (option === null) delete next[group];
      else next[group] = option;
      return next;
    });

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setView({ top: el.scrollTop, height: el.clientHeight });
  }

  // A list row carries only its columns; the dialog edits the whole record, with the row's plugin columns kept.
  async function open(mode: ViewMode, id: string) {
    const listed = visible.find((r) => String(r['id']) === id);
    try {
      const full = await api.object<Row>(obj.name).get(id);
      if (full !== null) setPanel({ mode, row: { ...listed, ...full } });
    } catch (err) {
      setReply({ text: err instanceof Error ? err.message : 'Cannot load the record.', failed: true });
    }
  }

  // Fixed layout: every column its width in characters (as in the TUI), cell padding included, except the first text
  // column, which takes what is left.
  const flexible = cols.find((c) => !c.thumbnail)?.key;
  const chars = (n: number) => `calc(${n}ch + 24px)`;
  const tableColumns: Column[] = [
    ...cols.map((c) => ({ key: c.key, label: c.thumbnail ? '' : c.label, ...(c.thumbnail ? { width: 80 } : c.key === flexible ? {} : { width: chars(c.width) }) })),
    // A pill adds its padding and border to the text.
    ...pluginColumns.map((c) => ({ key: c.id, label: c.label, width: `calc(${c.width ?? 12}ch + 48px)` })),
  ];
  const actionsWidth = 24 + (canViewObj ? 40 : 0) + (canEditObj ? 40 : 0) + rowActions.reduce((w, a) => w + a.label.length * 8 + 40, 0);
  const skeleton = (index: number) => {
    const cells: Record<string, ReactNode> = { __rowId: `${SKELETON}${index}` };
    for (const c of tableColumns) cells[c.key] = <span className={styles.skeleton} aria-hidden="true" />;
    return cells;
  };
  const tableRows = positions.map((index) => {
    const r = rowAt(index);
    if (r === undefined) return skeleton(index);
    const cells: Record<string, ReactNode> = {};
    for (const c of cols) cells[c.key] = renderCell(c, r, lifecycle);
    for (const c of pluginColumns) {
      const v = r[c.id] as { text: string; tone: PillTone; hint?: string } | null | undefined;
      cells[c.id] = v ? (
        <span title={v.hint}>
          <Pill tone={v.tone}>{v.text}</Pill>
        </span>
      ) : null;
    }
    cells['__rowId'] = String(r['id'] ?? '');
    return cells;
  });
  const byId = new Map(visible.map((r) => [String(r['id']), r]));
  const openView = (id: string) => void open('view', id);
  const openEdit = (id: string) => void open('edit', id);

  const newButton = canCreate ? (
    <Button variant="additive" onClick={() => setPanel({ mode: 'create', row: null })}>
      New {obj.title.toLowerCase()}
    </Button>
  ) : null;

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {obj.titlePlural} <span className={styles.count}>{total ?? ''}</span>
        </h1>
        <div className={styles.tools}>
          {filterGroups.map((g) => (
            <div key={g.label} className={styles.filter} role="group" aria-label={g.label}>
              {[null, ...g.options.map((o) => o.label)].map((option) => (
                <button
                  key={option ?? ''}
                  type="button"
                  className={styles.filterOption}
                  aria-pressed={(chosen[g.label] ?? null) === option}
                  onClick={() => choose(g.label, option)}
                >
                  {option ?? 'All'}
                </button>
              ))}
            </div>
          ))}
          {search !== undefined && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder={`Search ${obj.titlePlural.toLowerCase()}...`}
              count={total === null ? '' : `${total} found`}
            />
          )}
          {newButton}
        </div>
      </div>

      {error !== null && <div className={styles.error}>{error}</div>}
      {reply !== null && <div className={reply.failed ? styles.error : styles.muted}>{reply.text}</div>}

      {loading ? (
        <div className={styles.muted}>Loading {obj.titlePlural.toLowerCase()}...</div>
      ) : count === 0 && searched.trim() === '' && filter.length === 0 ? (
        <EmptyState
          title={`No ${obj.titlePlural.toLowerCase()} yet`}
          message={canCreate ? `Create your first ${obj.title.toLowerCase()} to get started.` : undefined}
          action={newButton}
        />
      ) : (
        <div className={styles.tableWrap} ref={scroller} onScroll={onScroll}>
          <Table
            rowHeight={rowHeight}
            actionsWidth={actionsWidth}
            padTop={start * rowHeight}
            padBottom={(count - end) * rowHeight}
            isPlaceholder={(id) => id.startsWith(SKELETON)}
            columns={tableColumns}
            rows={tableRows}
            rowId={(row) => String(row['__rowId'] ?? '')}
            onEdit={canEditObj ? openEdit : undefined}
            onView={canViewObj ? openView : undefined}
            rowActions={
              rowActions.length === 0
                ? undefined
                : (id) =>
                    rowActions.map((a) => {
                      const shown = a.disabledWhen === undefined ? undefined : (byId.get(id)?.[a.disabledWhen.column] as { text?: string } | null | undefined)?.text;
                      return (
                        <RecordAction
                          key={a.id}
                          baseUrl={resolveApiBaseUrl()}
                          action={a}
                          record={{ object: obj.name, id }}
                          disabled={a.disabledWhen !== undefined && shown === a.disabledWhen.equals}
                          onDone={(r) => {
                            setReply(r);
                            void refetch();
                          }}
                        />
                      );
                    })
            }
            emptyLabel="No matches"
          />
        </div>
      )}

      {panel !== null && (
        <ObjectPanel
          api={api}
          obj={obj}
          resolveObject={resolveObject}
          initialMode={panel.mode}
          row={panel.row}
          onClose={() => setPanel(null)}
          onChanged={refetch}
          onReply={setReply}
        />
      )}
    </div>
  );
}

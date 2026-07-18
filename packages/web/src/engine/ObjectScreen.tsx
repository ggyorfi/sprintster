import { useMemo, useState, type ReactNode } from 'react';
import {
  listColumns,
  filterByConfig,
  lifecycleInfo,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type SearchSpec,
  type ViewMode,
} from '@sprintster/engine';
import { Table, SearchBar, Button, EmptyState, type Column } from '../ui/index.js';
import { useObjectList } from './useObjectList.js';
import { renderCell } from './cells.js';
import { ObjectPanel } from './ObjectPanel.js';
import type { Row } from './resolve.js';
import styles from './ObjectScreen.module.css';

export interface ObjectScreenProps {
  api: ApiClient;
  obj: ObjectConfig;
  resolveObject: ObjectResolver;
}

export function ObjectScreen({ api, obj, resolveObject }: ObjectScreenProps) {
  const { rows, loading, error, refetch } = useObjectList(api, obj, resolveObject);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<{ mode: ViewMode; row: Row | null } | null>(null);

  const cols = useMemo(() => listColumns(obj, 'default', resolveObject), [obj, resolveObject]);
  const lifecycle = useMemo(() => lifecycleInfo(obj), [obj]);
  const search = obj.lists[0]?.search;
  const actions = obj.lists[0]?.actions ?? [];
  const canCreate = actions.some((a) => a.kind === 'create');
  const canEditObj = actions.some((a) => a.kind === 'edit');

  const visible = useMemo(
    () => (query.trim() !== '' && search !== undefined ? filterByConfig(rows, query, search as SearchSpec) : rows),
    [rows, query, search],
  );

  const tableColumns: Column[] = cols.map((c) => ({ key: c.key, label: c.label, width: c.width }));
  const tableRows = visible.map((r) => {
    const cells: Record<string, ReactNode> = {};
    for (const c of cols) cells[c.key] = renderCell(c, r, lifecycle);
    cells['__rowId'] = String(r['id'] ?? '');
    return cells;
  });
  const byId = new Map(visible.map((r) => [String(r['id']), r]));

  function openEdit(id: string) {
    const r = byId.get(id);
    if (r !== undefined) setPanel({ mode: 'edit', row: r });
  }

  const newButton = canCreate ? (
    <Button variant="additive" onClick={() => setPanel({ mode: 'create', row: null })}>
      New {obj.title.toLowerCase()}
    </Button>
  ) : null;

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {obj.titlePlural} <span className={styles.count}>{visible.length}</span>
        </h1>
        <div className={styles.tools}>
          {search !== undefined && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder={`Search ${obj.titlePlural.toLowerCase()}...`}
              count={`${visible.length} of ${rows.length}`}
            />
          )}
          {newButton}
        </div>
      </div>

      {error !== null && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.muted}>Loading {obj.titlePlural.toLowerCase()}...</div>
      ) : visible.length === 0 && query.trim() === '' ? (
        <EmptyState
          title={`No ${obj.titlePlural.toLowerCase()} yet`}
          message={canCreate ? `Create your first ${obj.title.toLowerCase()} to get started.` : undefined}
          action={newButton}
        />
      ) : (
        <div className={styles.tableWrap}>
          <Table
            columns={tableColumns}
            rows={tableRows}
            rowId={(row) => String(row['__rowId'] ?? '')}
            onEdit={canEditObj ? openEdit : undefined}
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
        />
      )}
    </div>
  );
}

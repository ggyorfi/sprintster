import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'node:crypto';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import {
  appConfig,
  arrayInitialValues,
  assembleValues,
  listColumns,
  isApiError,
  isNetworkError,
  toInput,
  viewFields,
  type ApiClient,
  type ListActionConfig,
  type ObjectConfig,
  type ObjectResolver,
  type ObjectStatus,
  type ViewMode,
} from '@sprintster/engine';
import { MenuBar, type MenuTitle } from './components/MenuBar.js';
import { ObjectList } from './components/ObjectList.js';
import { PopupForm, type PopupFormValues, type RefOptionMap } from './components/PopupForm.js';
import type { PickerOption } from './components/Picker.js';
import { adjustScrollTop, listNavTarget } from './list-nav.js';
import { filterHelp, listActions, objectHelp } from './help.js';
import { makeFilter } from './search.js';
import { loadScrollOff } from './config.js';
import { THEME } from './theme.js';

const LIST_VERTICAL_RESERVE = 6;

type Mode = 'list' | 'panel';
type Row = Record<string, unknown>;

interface PanelState {
  mode: ViewMode;
  viewName: string;
  original: Row | null;
}

const rowId = (r: Row): string => String(r['id']);

const resolveObject: ObjectResolver = (name) => appConfig.objects.find((o) => o.name === name);

function valueAtPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
}

function firstLabelField(obj: ObjectConfig | undefined): string {
  const col = obj?.lists[0]?.columns.find((c) => !c.property.includes('.') && c.property !== 'id');
  return col?.property ?? 'id';
}

interface ContextDef {
  id: string;
  label: string;
  hotkey: string;
  obj: ObjectConfig | null;
}

const MAINTENANCE_HELP = 'Tab next · Alt+Q quit  (coming soon)';

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function freshnessLabel(status: ObjectStatus | null): string {
  if (status === null) return '';
  if (status.syncing) return 'syncing...';
  if (status.lastError !== null) return 'sync failed';
  if (status.lastSyncedAt === null) return 'not synced';
  return `synced ${formatAgo(Date.now() - status.lastSyncedAt)}`;
}

export interface AppProps {
  apiClient: ApiClient;
  daemonUrl: string;
}

function panelTitle(obj: ObjectConfig, viewName: string, mode: ViewMode): string {
  const view = obj.views?.find((v) => v.name === viewName);
  const base = view?.title ?? obj.title;
  if (mode === 'create') return `New ${base.toLowerCase()}`;
  if (mode === 'edit') return `Edit ${base.toLowerCase()}`;
  return base;
}

export function App({ apiClient, daemonUrl }: AppProps): React.JSX.Element {
  const CONTEXTS = useMemo<ReadonlyArray<ContextDef>>(
    () => [
      ...appConfig.objects.map((obj) => ({
        id: obj.name,
        label: obj.titlePlural,
        hotkey: obj.titlePlural.charAt(0).toLowerCase(),
        obj,
      })),
      { id: 'maintenance', label: 'Maintenance', hotkey: 'm', obj: null },
    ],
    [],
  );
  const TITLES = useMemo<ReadonlyArray<MenuTitle>>(
    () => [...CONTEXTS.map((c) => ({ label: c.label, hotkey: c.hotkey })), { label: 'Quit', hotkey: 'q' }],
    [CONTEXTS],
  );
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 26;
  const cols = stdout?.columns ?? 80;

  const [data, setData] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const scrollOff = loadScrollOff();
  const listCapacity = Math.max(1, termRows - LIST_VERTICAL_RESERVE);

  const [mode, setMode] = useState<Mode>('list');
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [panelInitial, setPanelInitial] = useState<PopupFormValues>({});
  const [contextIndex, setContextIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [refOptions, setRefOptions] = useState<RefOptionMap>({});
  const [pendingDelete, setPendingDelete] = useState<{ row: Row; message: string } | null>(null);
  const [objectStatus, setObjectStatus] = useState<ObjectStatus | null>(null);

  const activeContext = CONTEXTS[contextIndex];
  const activeObj = activeContext?.obj ?? null;
  const columns = useMemo(() => (activeObj ? listColumns(activeObj, 'default', resolveObject) : []), [activeObj]);
  const filter = useMemo(() => (activeObj ? makeFilter<Row>(activeObj) : null), [activeObj]);
  const labelField = useMemo(
    () => (activeObj ? firstLabelField(activeObj) : 'id'),
    [activeObj],
  );

  const visibleRows = useMemo(
    () => (query.trim() === '' || filter === null ? data : filter(data, query)),
    [data, query, filter],
  );

  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, visibleRows.length - 1)));
  }, [visibleRows.length]);

  useEffect(() => {
    setQuery('');
    setSearching(false);
    setSelected(0);
    setScrollTop(0);
  }, [contextIndex]);

  function applyQuery(next: string): void {
    setQuery(next);
    setSelected(0);
    setScrollTop(0);
  }

  function exitSearch(): void {
    setSearching(false);
    applyQuery('');
  }

  const enrichRefColumns = useCallback(
    async (obj: ObjectConfig, rows: Row[]): Promise<Row[]> => {
      const specs = (obj.lists[0]?.columns ?? [])
        .filter((c) => c.property.includes('.'))
        .map((c) => {
          const dot = c.property.indexOf('.');
          const refName = c.property.slice(0, dot);
          const leaf = c.property.slice(dot + 1);
          const refProp = obj.properties.find((p) => p.name === refName);
          if (refProp === undefined || refProp.type !== 'ref') return null;
          return { key: c.property, refName, leaf, target: refProp.target };
        })
        .filter((s): s is { key: string; refName: string; leaf: string; target: string } => s !== null);
      if (specs.length === 0) return rows;
      const maps = new Map<string, Map<string, Row>>();
      for (const target of new Set(specs.map((s) => s.target))) {
        const list = await apiClient.object<Row>(target).list();
        maps.set(target, new Map(list.map((r) => [String(r['id']), r])));
      }
      return rows.map((row) => {
        const out: Row = { ...row };
        for (const s of specs) {
          const targetRow = maps.get(s.target)?.get(String(row[s.refName]));
          out[s.key] = targetRow ? targetRow[s.leaf] ?? null : null;
        }
        return out;
      });
    },
    [apiClient],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (activeObj === null) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fetched = await apiClient.object<Row>(activeObj.name).list();
      const enriched = await enrichRefColumns(activeObj, fetched);
      setData(enriched);
      setSelected((i) => Math.min(i, Math.max(0, enriched.length - 1)));
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(formatError(err, daemonUrl));
    } finally {
      setLoading(false);
    }
  }, [apiClient, daemonUrl, activeObj, enrichRefColumns]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadStatus = useCallback(async (): Promise<void> => {
    if (activeObj === null) {
      setObjectStatus(null);
      return;
    }
    try {
      setObjectStatus(await apiClient.object(activeObj.name).status());
    } catch {
      setObjectStatus(null);
    }
  }, [apiClient, activeObj]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const [, setNowTick] = useState(0);
  const hasStatus = objectStatus !== null;
  useEffect(() => {
    if (!hasStatus) return;
    const timer = setInterval(() => setNowTick((t) => t + 1), 10_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [hasStatus]);

  async function syncNow(): Promise<void> {
    if (activeObj === null || objectStatus === null) return;
    setStatusMessage('Syncing...');
    try {
      const s = await apiClient.object(activeObj.name).sync();
      setObjectStatus(s);
      await refresh();
      setStatusMessage(s.lastError !== null ? `Sync failed: ${s.lastError}` : `Synced ${s.count}.`);
    } catch (err) {
      setStatusMessage(`Sync failed: ${formatError(err, daemonUrl)}`);
      void loadStatus();
    }
  }

  const loadRefOptions = useCallback(
    async (obj: ObjectConfig, viewName: string, panelMode: ViewMode): Promise<void> => {
      const specs = viewFields(obj, viewName, panelMode, resolveObject);
      const refs = specs.filter((f) => f.property.type === 'ref' && f.editable && f.derivedFromRef === null);
      const refTargets = new Set<string>();
      for (const f of refs) {
        if (f.property.type !== 'ref') continue;
        refTargets.add(f.property.target);
      }
      const lists = new Map<string, Row[]>();
      for (const target of refTargets) {
        const list = await apiClient.object<Row>(target).list();
        lists.set(target, list);
      }
      const next: Record<string, PickerOption[]> = {};
      for (const f of refs) {
        if (f.property.type !== 'ref') continue;
        const labelFieldName = f.property.display ?? firstLabelField(resolveObject(f.property.target));
        const list = lists.get(f.property.target) ?? [];
        next[f.path] = list.map((r) => ({ id: String(r['id']), label: String(r[labelFieldName] ?? r['id']), raw: r }));
      }
      setRefOptions(next);
    },
    [apiClient],
  );

  function buildPanel(action: ListActionConfig, source: Row | null): void {
    if (activeObj === null || action.view === undefined || action.kind === 'delete') return;
    const panelMode: ViewMode = action.kind;
    const specs = viewFields(activeObj, action.view, panelMode, resolveObject);
    const initial: PopupFormValues = {};
    for (const f of specs) {
      if (f.property.type === 'array') {
        if (panelMode !== 'create' && source !== null) {
          Object.assign(initial, arrayInitialValues(f.property, f.path, valueAtPath(source, f.path)));
        }
        continue;
      }
      if (panelMode === 'create') {
        initial[f.path] = f.defaultInput;
      } else if (source !== null && f.derivedFromRef === null) {
        initial[f.path] = toInput(f.property, valueAtPath(source, f.path));
      }
    }
    setPanel({ mode: panelMode, viewName: action.view, original: source });
    setPanelInitial(initial);
    setFormError(null);
    setRefOptions({});
    void loadRefOptions(activeObj, action.view, panelMode);
    setMode('panel');
  }

  async function openEditPanel(action: ListActionConfig, row: Row): Promise<void> {
    if (activeObj === null) return;
    let source = row;
    try {
      const fresh = await apiClient.object<Row>(activeObj.name).refresh(rowId(row));
      if (fresh !== null) source = fresh;
    } catch {
      // source stays the cached row; the save path still surfaces conflicts
    }
    buildPanel(action, source);
  }

  function openPanel(action: ListActionConfig, row: Row | null): void {
    if (activeObj === null) return;
    if (action.kind === 'delete') {
      if (row === null) return;
      const label = String(row[labelField] ?? activeObj.title.toLowerCase());
      const message = action.confirm ?? `Delete "${label}"?`;
      setPendingDelete({ row, message });
      return;
    }
    if (action.view === undefined) return;
    if (action.kind === 'edit' && row !== null && objectStatus !== null) {
      void openEditPanel(action, row);
      return;
    }
    buildPanel(action, row);
  }

  function closePanel(reason?: 'cancel' | 'view'): void {
    const wasEdit = panel?.mode === 'edit';
    const wasCreate = panel?.mode === 'create';
    setMode('list');
    setPanel(null);
    setFormError(null);
    if (reason === 'cancel') {
      setStatusMessage(wasEdit ? 'Edit cancelled.' : wasCreate ? 'Add cancelled.' : null);
    }
  }

  async function handleDelete(row: Row | null): Promise<void> {
    if (activeObj === null || row === null) return;
    const label = String(row[labelField] ?? activeObj.title.toLowerCase());
    setStatusMessage(`Deleting ${label}...`);
    try {
      await apiClient.object(activeObj.name).remove(rowId(row));
      setStatusMessage(`Removed ${label}.`);
      await refresh();
    } catch (err) {
      setStatusMessage(`Delete failed: ${formatError(err, daemonUrl)}`);
    }
  }

  async function runTransition(commandName: string): Promise<void> {
    if (activeObj === null) return;
    const target = visibleRows[selected];
    if (target === undefined) return;
    const label = String(target[labelField] ?? activeObj.title.toLowerCase());
    setStatusMessage(`${commandName} ${label}...`);
    try {
      await apiClient.object(activeObj.name).transition(rowId(target), commandName);
      setStatusMessage(`${commandName}: ${label} done.`);
      await refresh();
    } catch (err) {
      setStatusMessage(`${commandName} failed: ${formatError(err, daemonUrl)}`);
    }
  }

  useInput((input, key) => {
    if (mode === 'panel') return;

    if (pendingDelete !== null) {
      const row = pendingDelete.row;
      setPendingDelete(null);
      if (input === 'y' || input === 'Y') {
        void handleDelete(row);
      } else {
        setStatusMessage('Delete cancelled.');
      }
      return;
    }

    if (searching) {
      if (key.escape) {
        exitSearch();
        return;
      }
      if (key.return) {
        setSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        applyQuery(query.slice(0, -1));
        return;
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.tab) {
        applyQuery(query + input);
        return;
      }
      return;
    }

    if (key.meta) {
      const lc = input.toLowerCase();
      if (lc === 'q') {
        exit();
        return;
      }
      const idx = CONTEXTS.findIndex((c) => c.hotkey === lc);
      if (idx >= 0) {
        setContextIndex(idx);
        setStatusMessage(null);
        return;
      }
    }

    if (key.tab && key.shift) {
      setContextIndex((i) => (i - 1 + CONTEXTS.length) % CONTEXTS.length);
      setStatusMessage(null);
      return;
    }
    if (key.tab) {
      setContextIndex((i) => (i + 1) % CONTEXTS.length);
      setStatusMessage(null);
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (activeObj !== null) {
      if (!key.ctrl && input === '/') {
        setSearching(true);
        return;
      }
      if (key.escape && query !== '') {
        exitSearch();
        return;
      }
      if (!key.ctrl && input === 'r') {
        void refresh();
        return;
      }
      if (!key.ctrl && input === 's' && objectStatus !== null) {
        void syncNow();
        return;
      }

      const actions = listActions(activeObj);
      const action = actions.find((a) => a.hotkey === input);
      if (action !== undefined && !key.ctrl) {
        const row = action.kind === 'create' ? null : (visibleRows[selected] ?? null);
        if (action.kind !== 'create' && row === null) {
          setStatusMessage(`Nothing to ${action.label}.`);
          return;
        }
        openPanel(action, row);
        return;
      }

      if (!key.ctrl && activeObj.commands !== undefined) {
        const cmd = activeObj.commands.find((c) => c.hotkey === input);
        if (cmd !== undefined) {
          void runTransition(cmd.name);
          return;
        }
      }

      const navTarget = listNavTarget(input, key, selected, visibleRows.length, listCapacity);
      if (navTarget !== null) {
        setSelected(navTarget);
        setScrollTop((top) => adjustScrollTop(top, navTarget, listCapacity, visibleRows.length, scrollOff));
        return;
      }
    }
  });

  async function handlePanelSubmit(values: PopupFormValues): Promise<void> {
    if (activeObj === null || panel === null) return;
    const { mode: panelMode, viewName, original } = panel;
    const assembled = assembleValues(activeObj, viewName, values, panelMode);
    const label = String(values[labelField] ?? '') || activeObj.title.toLowerCase();
    setFormError(null);
    try {
      if (panelMode === 'create') {
        setStatusMessage(`Adding ${label}...`);
        await apiClient.object(activeObj.name).add({ id: randomUUID(), ...assembled });
        setStatusMessage(`Added ${label}.`);
      } else if (panelMode === 'edit' && original !== null) {
        const editLabel = String(original[labelField] ?? activeObj.title.toLowerCase());
        setStatusMessage(`Updating ${editLabel}...`);
        await apiClient.object(activeObj.name).update(rowId(original), assembled);
        setStatusMessage(`Updated ${editLabel}.`);
      }
      setMode('list');
      setPanel(null);
      await refresh();
    } catch (err) {
      setPanelInitial(values);
      setFormError(formatError(err, daemonUrl));
    }
  }

  const filterActive = query.trim() !== '';
  const activeTitleIndex = mode === 'panel' ? null : contextIndex;
  let helpText: string;
  let helpColor: string;
  if (pendingDelete !== null) {
    helpText = `${pendingDelete.message} (y/N)`;
    helpColor = THEME.errorColor;
  } else if (searching) {
    helpText = `Search: ${query}▌`;
    helpColor = THEME.highlightColor;
  } else if (statusMessage !== null) {
    helpText = statusMessage;
    helpColor = THEME.highlightColor;
  } else if (activeObj !== null && filterActive) {
    helpText = filterHelp(activeObj);
    helpColor = THEME.mutedColor;
  } else if (activeObj !== null) {
    helpText = objectHelp(activeObj) + (objectStatus !== null ? ' · s sync' : '');
    helpColor = THEME.mutedColor;
  } else {
    helpText = MAINTENANCE_HELP;
    helpColor = THEME.mutedColor;
  }

  const freshnessText = freshnessLabel(objectStatus);

  const listCounter = activeObj === null
    ? ''
    : visibleRows.length === 0
      ? (searching || filterActive ? '0 matches' : '')
      : `${selected + 1}/${visibleRows.length}`;

  const overlayWidth = Math.max(0, cols - 4);

  return (
    <Box flexDirection="column" height={termRows} position="relative">
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={THEME.accentColor} paddingTop={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        {activeObj !== null ? (
          loading && data.length === 0 ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
              <Text dimColor>Loading {activeObj.titlePlural.toLowerCase()} from {daemonUrl}...</Text>
            </Box>
          ) : visibleRows.length === 0 ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
              <Text dimColor>
                {filterActive || searching
                  ? `No ${activeObj.titlePlural.toLowerCase()} match "${query}".`
                  : `No ${activeObj.titlePlural.toLowerCase()} yet.`}
              </Text>
            </Box>
          ) : (
            <ObjectList rows={visibleRows} columns={columns} idField="id" selectedIndex={selected} width={Math.max(0, cols - 6)} scrollTop={scrollTop} capacity={listCapacity} />
          )
        ) : (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text dimColor>Maintenance: backups / health (coming soon).</Text>
          </Box>
        )}
      </Box>

      <Box position="absolute" marginLeft={2} marginTop={0}>
        <MenuBar titles={TITLES} activeIndex={activeTitleIndex} width={overlayWidth} />
      </Box>

      <Box position="absolute" marginLeft={2} marginTop={termRows - 1} width={overlayWidth} flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Text color={helpColor} wrap="truncate-end">
            {' '}{helpText}{' '}
          </Text>
        </Box>
        {freshnessText !== '' ? (
          <Box flexShrink={0}>
            <Text color={THEME.mutedColor}>{' '}{freshnessText}{listCounter !== '' ? ' · ' : ' '}</Text>
          </Box>
        ) : null}
        {listCounter !== '' ? (
          <Box flexShrink={0}>
            <Text color={THEME.mutedColor}>{listCounter}{' '}</Text>
          </Box>
        ) : null}
      </Box>

      {mode === 'panel' && panel !== null && activeObj !== null ? (
        <PopupForm
          title={panelTitle(activeObj, panel.viewName, panel.mode)}
          fields={viewFields(activeObj, panel.viewName, panel.mode, resolveObject)}
          fieldWidth={activeObj.views?.find((v) => v.name === panel.viewName)?.fieldWidth}
          initial={panelInitial}
          refOptions={refOptions}
          errorMessage={formError}
          mode={panel.mode}
          onSubmit={panel.mode === 'view' ? undefined : handlePanelSubmit}
          onCancel={() => closePanel('cancel')}
        />
      ) : null}
    </Box>
  );
}

function formatError(err: unknown, daemonUrl: string): string {
  if (isNetworkError(err)) return `Cannot reach daemon at ${daemonUrl}.`;
  if (isApiError(err)) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

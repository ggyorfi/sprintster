import type { z } from 'zod';
import type { Config, ObjectConfig } from '../config/schema.js';
import type { ListPage, ListParams } from '../engine/list-query.js';
import type { PinRow } from '../events/query.js';

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ObjectStatus {
  lastSyncedAt: number | null;
  syncing: boolean;
  lastError: string | null;
  count: number;
}

export interface PluginObjectApi<S extends { id: string }> {
  list(): Promise<S[]>;
  // ADR 24 and 26; absent on objects backed by something other than the log.
  query?(params: ListParams): Promise<ListPage>;
  pin?(set: string, id: string, position: number): Promise<void>;
  unpin?(set: string, id: string): Promise<void>;
  queryPinned?(set: string, params: ListParams): Promise<ListPage>;
  // ADR 21; absent on objects backed by something other than the log.
  listAt?(at: { position: number; positions?: Readonly<Record<string, number>> }): Promise<S[]>;
  get(id: string): Promise<S | null>;
  requireGet(id: string): Promise<S>;
  add?(input: unknown, actor?: string): Promise<S>;
  update?(id: string, input: unknown, actor?: string): Promise<S>;
  remove?(id: string, actor?: string): Promise<S>;
  runCommand?(id: string, name: string, actor?: string): Promise<S>;
  // ADR 18: gone for good, or the fields nulled in every event.
  erase?(id: string, actor?: string): Promise<void>;
  redact?(id: string, fields: readonly string[], actor?: string): Promise<S>;
  createSchema?: z.ZodTypeAny;
  updateSchema?: z.ZodTypeAny;
  /** Freshness/health of an externally-backed object's cache. Mounts GET /<plural>/_status. */
  status?(): Promise<ObjectStatus>;
  /** Force a refresh from the source. Mounts POST /<plural>/_sync. */
  sync?(): Promise<ObjectStatus>;
  /** Refetch a single record from the source (for edit-open). Mounts POST /<plural>/:id/_refresh. */
  refresh?(id: string): Promise<S | null>;
}

export interface ObjectRegistration<S extends { id: string } = { id: string }> {
  config: ObjectConfig;
  api: PluginObjectApi<S>;
}

export interface CliCommand {
  verb: string;
  description: string;
  args?: z.ZodTypeAny;
  run(args: unknown, ctx: CliRunContext): Promise<number>;
}

export interface CliRunContext {
  logger: Logger;
  config: unknown;
}

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Mounted at /plugins/<namespace><path>; `path` starts with a slash and may hold `:param` segments.
export interface PluginRoute {
  method: RouteMethod;
  path: string;
  handler(request: Request, params: Record<string, string>): Promise<Response>;
}

// A route callers reach without the API's auth; the plugin checks each request itself (ADR 16).
export interface PublicRoute {
  method: RouteMethod;
  path: string;
}

// Where the GUIs show an action or badge: the sidebar (default), the Maintenance page for rarely used switches, or a record's dialog (ADR 22).
export type GuiPlacement = 'sidebar' | 'maintenance' | 'record';

// A button; pressing it POSTs to `route` and shows the reply's `message`. `hotkey` is for the TUI.
export interface GuiAction {
  id: string;
  label: string;
  route: string;
  confirm?: string;
  hotkey?: string;
  placement?: GuiPlacement;
  // With placement 'record': the objects it applies to, every object when absent. It POSTs { object, id }.
  objects?: string[];
  // ADR 25: also a button in each list row; disabled where a plugin column shows `equals`.
  inList?: boolean;
  disabledWhen?: { column: string; equals: string };
  // ADR 25: asks for one value first; the POST body carries it as `value`, null when an optional one is left empty.
  input?: { type: 'datetime'; label: string; optional?: boolean };
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

// Short status text; the GUI GETs `route` for `{ text, tone }`, every `refresh` seconds and after any action.
export interface GuiBadge {
  id: string;
  route: string;
  refresh?: number;
  placement?: GuiPlacement;
  // With placement 'record': as for an action; the route is called with ?object=&id=.
  objects?: string[];
}

// ADR 25: a value per record that lists show; rows carry it under the column's id.
export interface GuiColumn {
  id: string;
  label: string;
  objects?: string[];
  // In characters, as list column widths are.
  width?: number;
}

// `hint` is shown on hover, so the text itself can stay short.
export type ColumnValue = { text: string; tone: BadgeTone; hint?: string };

export interface GuiColumnSource extends GuiColumn {
  values(object: string, ids: string[]): Promise<Record<string, ColumnValue>>;
}

// What /config lists: ids prefixed with the namespace, routes as full daemon paths.
export interface GuiExtensions {
  actions: GuiAction[];
  badges: GuiBadge[];
  columns?: GuiColumn[];
}

export function columnsFor(extensions: GuiExtensions, object: string): GuiColumn[] {
  return (extensions.columns ?? []).filter((c) => c.objects === undefined || c.objects.includes(object));
}

export function extensionsAt(extensions: GuiExtensions, placement: GuiPlacement): GuiExtensions {
  const here = (e: { placement?: GuiPlacement }) => (e.placement ?? 'sidebar') === placement;
  return { actions: extensions.actions.filter(here), badges: extensions.badges.filter(here) };
}

// The record actions and badges that apply to one object.
export function recordExtensions(extensions: GuiExtensions, object: string): GuiExtensions {
  const here = (e: { objects?: string[] }) => e.objects === undefined || e.objects.includes(object);
  const at = extensionsAt(extensions, 'record');
  return { actions: at.actions.filter(here), badges: at.badges.filter(here) };
}

export interface LogChange {
  position: number;
  object: string;
  id: string;
  event: string;
  at: string;
  actor: string;
}

export interface PluginData {
  object(name: string): PluginObjectApi<{ id: string }>;
  position(): Promise<number>;
  changesSince(position: number): Promise<LogChange[]>;
  // ADR 26: what was pinned or unpinned in a set after a sequence number, every object, a page at a time.
  pinnedSince(set: string, after: number, limit: number): Promise<{ pins: PinRow[]; next: number | null }>;
}

// Pushes to every client connected at /plugins/<namespace>/channels/<name>. A message is sent as JSON; clients never send.
export interface Channel {
  send(message: unknown): void;
}

export interface DaemonRegistries {
  // The loaded app config. Read it here, not from the engine's module state: a plugin bundled apart from the host has its own copy of that.
  app: Config;
  objects: { register(o: ObjectRegistration): void };
  routes: { register(r: PluginRoute): void };
  channels: { open(name: string): Channel };
  gui: { action(a: GuiAction): void; badge(b: GuiBadge): void; column(c: GuiColumnSource): void };
  data: PluginData;
  // Exactly the secrets the manifest declares; every required one is present and non-empty, an optional one only when set.
  secrets: Readonly<Record<string, string>>;
}

export interface CliRegistries {
  cli: { register(c: CliCommand): void };
}

export interface TuiRegistries {
  objects: { register(o: { config: ObjectConfig }): void };
}

export interface PluginContext<R extends object = object> {
  config: unknown;
  logger: Logger;
}

export type DaemonPluginContext = PluginContext & DaemonRegistries;
export type CliPluginContext = PluginContext & CliRegistries;
export type TuiPluginContext = PluginContext & TuiRegistries;

export interface PluginManifest<Ctx extends PluginContext = PluginContext> {
  name: string;
  namespace: string;
  version: string;
  capabilities: ReadonlyArray<string>;
  config: z.ZodTypeAny;
  setup?: string;
  isSetUp?(config: unknown): boolean | Promise<boolean>;
  // Static, so a host can read them without running init: routes left open by its gate, and the secret names to hand over.
  publicRoutes?: ReadonlyArray<PublicRoute>;
  secrets?: ReadonlyArray<string>;
  optionalSecrets?: ReadonlyArray<string>;
  init(ctx: Ctx): void | Promise<void>;
}

export type DaemonPlugin = PluginManifest<DaemonPluginContext>;
export type CliPlugin = PluginManifest<CliPluginContext>;
export type TuiPlugin = PluginManifest<TuiPluginContext>;

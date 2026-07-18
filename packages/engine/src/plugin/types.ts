import type { z } from 'zod';
import type { ObjectConfig } from '../config/schema.js';

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
  get(id: string): Promise<S | null>;
  requireGet(id: string): Promise<S>;
  add?(input: unknown, actor?: string): Promise<S>;
  update?(id: string, input: unknown, actor?: string): Promise<S>;
  remove?(id: string, actor?: string): Promise<S>;
  runCommand?(id: string, name: string, actor?: string): Promise<S>;
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

export interface DaemonRegistries {
  objects: { register(o: ObjectRegistration): void };
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
  init(ctx: Ctx): void | Promise<void>;
}

export type DaemonPlugin = PluginManifest<DaemonPluginContext>;
export type CliPlugin = PluginManifest<CliPluginContext>;
export type TuiPlugin = PluginManifest<TuiPluginContext>;

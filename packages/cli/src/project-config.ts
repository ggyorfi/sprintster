import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadConfig, type Config } from '@sprintster/engine';

const BackendConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sqlite'), path: z.string() }).strict(),
  z.object({ kind: z.literal('postgres'), url: z.string() }).strict(),
]);
export type BackendConfig = z.infer<typeof BackendConfig>;

const ServerConfig = z
  .object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().default(3030),
  })
  .strict();

const EnvironmentConfig = z
  .object({
    backend: BackendConfig,
    server: ServerConfig.default(() => ServerConfig.parse({})),
  })
  .strict();
export type EnvironmentConfig = z.infer<typeof EnvironmentConfig>;

const ProjectConfigRaw = z
  .object({
    configVersion: z.literal('1'),
    app: z.unknown(),
    environments: z.record(z.string(), EnvironmentConfig),
  })
  .strict();

export interface ProjectConfig {
  configVersion: '1';
  app: Config;
  environments: Record<string, EnvironmentConfig>;
}

export function parseProjectConfig(raw: unknown): ProjectConfig {
  const parsed = ProjectConfigRaw.parse(raw);
  return {
    configVersion: parsed.configVersion,
    app: loadConfig(parsed.app),
    environments: parsed.environments,
  };
}

export function projectConfigPath(): string {
  const override = process.env['SPRINTSTER_CONFIG'];
  if (override !== undefined && override !== '') return override;
  return join(process.cwd(), 'sprintster.config.json');
}

export function loadProjectConfig(path: string): ProjectConfig {
  return parseProjectConfig(JSON.parse(readFileSync(path, 'utf8')));
}

export function selectEnvironment(cfg: ProjectConfig, env: string): EnvironmentConfig {
  const found = cfg.environments[env];
  if (found === undefined) {
    const names = Object.keys(cfg.environments).join(', ');
    throw new Error(`unknown environment '${env}' (have: ${names})`);
  }
  return found;
}

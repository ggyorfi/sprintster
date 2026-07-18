import { loadConfig } from './loader.js';
import type { Config } from './schema.js';
import { invalidateEventSchemas } from '../events/registry.js';

// The engine ships no objects of its own; a host installs its config via
// setAppConfig at boot. Until then appConfig is a valid, empty config.
export let appConfig: Config = loadConfig({ version: '1', objects: [] });

export function setAppConfig(c: Config): void {
  appConfig = c;
  invalidateEventSchemas();
}

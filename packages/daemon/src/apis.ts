import { createObjectApi, type Config, type EventStore, type PluginObjectApi } from '@sprintster/engine';
import type { MountedObject } from './app.js';

// One api per configured object, each able to resolve the others for ref validation.
export function buildApis(config: Config, store: EventStore): MountedObject[] {
  const apiByName: Record<string, PluginObjectApi<{ id: string }>> = {};
  const resolveTarget = (name: string): PluginObjectApi<{ id: string }> | undefined => apiByName[name];
  return config.objects.map((obj) => {
    const api = createObjectApi<{ id: string }>(store, obj, { resolveTarget });
    apiByName[obj.name] = api;
    return { obj, api };
  });
}

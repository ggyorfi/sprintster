import { loadConfig, setAppConfig } from '@sprintster/engine';

interface ServerConfig {
  version?: string;
  theme?: unknown;
  objects?: unknown;
}

/*
 * Replaces the bundled default config with the daemon's RESOLVED config (objects
 * incl. plugin-contributed ones like `contact`, plus the live theme), so the web
 * renders exactly what the daemon serves. Falls back to the bundled default when
 * the daemon is unreachable so the app still loads. Plugins (which hold secrets)
 * are never sent by the daemon; we inject an empty list.
 */
export async function loadServerConfig(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/config`);
    if (!res.ok) return false;
    const raw = (await res.json()) as ServerConfig;
    if (!Array.isArray(raw.objects)) return false;
    setAppConfig(
      loadConfig({ version: raw.version ?? '1', theme: raw.theme ?? {}, objects: raw.objects, plugins: [] }),
    );
    return true;
  } catch {
    return false;
  }
}

export interface ApiEnv {
  VITE_API_URL?: string;
}

// The bundle is emitted under `_app/` beneath wherever the shell is mounted, so its own URL says where that is.
export function appRootFrom(moduleUrl: string): string {
  const at = moduleUrl.indexOf('/_app/');
  return at < 0 ? '' : moduleUrl.slice(0, at);
}

// VITE_API_URL is for an API on another origin (dev proxy, cloud build). Unset, the API is at the mount point, whatever that is.
export function resolveApiBaseUrl(env: ApiEnv = import.meta.env, moduleUrl: string = import.meta.url): string {
  return env.VITE_API_URL ?? appRootFrom(moduleUrl);
}

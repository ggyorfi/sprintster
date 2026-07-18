export interface ApiEnv {
  VITE_API_URL?: string;
}

// Unset: same-origin (the daemon hosts the bundle). Dev sets VITE_API_URL=/api (proxied). A cloud build sets a full URL.
export function resolveApiBaseUrl(env: ApiEnv = import.meta.env): string {
  return env.VITE_API_URL ?? '';
}

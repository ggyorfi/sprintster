import { createApiClient, type ApiClient } from '@sprintster/engine';
import { resolveApiBaseUrl } from './config.js';

export interface WebApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createWebApiClient(options: WebApiOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? resolveApiBaseUrl();
  return createApiClient(baseUrl, options.fetch ? { fetch: options.fetch } : {});
}

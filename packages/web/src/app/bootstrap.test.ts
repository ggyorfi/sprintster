import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appConfig, setAppConfig, loadConfig, fixtureAppRaw } from '@sprintster/engine';
import { loadServerConfig } from './bootstrap.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  setAppConfig(loadConfig(fixtureAppRaw));
});

afterEach(() => {
  setAppConfig(loadConfig(fixtureAppRaw));
});

describe('loadServerConfig', () => {
  it('injects the daemon config so plugin-contributed objects become available', async () => {
    const contactLike = { ...fixtureAppRaw.objects[0], name: 'contact', title: 'Contact', titlePlural: 'Contacts' };
    const serverConfig = {
      version: '1',
      theme: fixtureAppRaw.theme,
      objects: [...fixtureAppRaw.objects, contactLike],
    };
    const fetchMock = async () => jsonResponse(serverConfig);

    const ok = await loadServerConfig('/api', fetchMock as unknown as typeof fetch);

    expect(ok).toBe(true);
    expect(appConfig.objects.map((o) => o.name)).toContain('contact');
  });

  it('keeps the bundled config when the daemon is unreachable', async () => {
    const fetchMock = async () => {
      throw new Error('down');
    };

    const ok = await loadServerConfig('/api', fetchMock as unknown as typeof fetch);

    expect(ok).toBe(false);
    expect(appConfig.objects.map((o) => o.name)).toEqual(['client', 'memo']);
  });
});

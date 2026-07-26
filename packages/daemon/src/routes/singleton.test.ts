import { describe, it, expect } from 'vitest';
import { createObjectApi, InMemoryEventStore, loadConfig, type ObjectConfig } from '@sprintster/engine';
import { createApp } from '../app.js';

function settingsConfig(props: unknown[] = []): ObjectConfig {
  const config = loadConfig({
    version: '1',
    objects: [
      {
        name: 'settings',
        title: 'Site Setting',
        titlePlural: 'Site Settings',
        singleton: true,
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'siteTitle', type: 'text', title: 'Site title', default: 'My site' },
          { name: 'baseUrl', type: 'text', title: 'Base URL' },
          { name: 'postsPerPage', type: 'integer', title: 'Posts per page' },
          ...props,
        ],
        lists: [],
        views: [{ name: 'default', title: 'Settings', fields: [{ property: 'siteTitle' }, { property: 'baseUrl' }] }],
      },
    ],
  });
  return config.objects[0]!;
}

function buildApp(obj = settingsConfig()) {
  const store = new InMemoryEventStore();
  const api = createObjectApi<{ id: string }>(store, obj);
  return createApp({ apis: [{ obj, api }] });
}

const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('singleton daemon route', () => {
  it('GET returns an object, not a list', async () => {
    const res = await buildApp().request('/site-settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(false);
    expect(body).toMatchObject({ siteTitle: 'My site' });
  });

  it('projects unsaved fields from defaults and type zero values', async () => {
    const body = (await (await buildApp().request('/site-settings')).json()) as Record<string, unknown>;
    expect(body['siteTitle']).toBe('My site');
    expect(body['baseUrl']).toBe('');
    expect(body['postsPerPage']).toBe(0);
  });

  it('reads back what was saved, and keeps defaults for untouched fields', async () => {
    const app = buildApp();
    const saved = await app.request('/site-settings', patch({ baseUrl: 'https://example.com' }));
    expect(saved.status).toBe(200);
    const body = (await (await app.request('/site-settings')).json()) as Record<string, unknown>;
    expect(body['baseUrl']).toBe('https://example.com');
    expect(body['siteTitle']).toBe('My site');
  });

  it('survives a second save (update after lazy creation)', async () => {
    const app = buildApp();
    await app.request('/site-settings', patch({ baseUrl: 'https://one.example' }));
    await app.request('/site-settings', patch({ baseUrl: 'https://two.example', postsPerPage: 20 }));
    const body = (await (await app.request('/site-settings')).json()) as Record<string, unknown>;
    expect(body['baseUrl']).toBe('https://two.example');
    expect(body['postsPerPage']).toBe(20);
  });

  it('exposes no create, delete or id routes', async () => {
    const app = buildApp();
    expect((await app.request('/site-settings', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await app.request('/site-settings/settings', { method: 'DELETE' })).status).toBe(404);
    expect((await app.request('/site-settings/settings')).status).toBe(404);
  });

  it('rejects an unknown field', async () => {
    const res = await buildApp().request('/site-settings', patch({ nope: 1 }));
    expect(res.status).toBe(400);
  });

  it('always reports the same id', async () => {
    const app = buildApp();
    const before = (await (await app.request('/site-settings')).json()) as { id: string };
    await app.request('/site-settings', patch({ baseUrl: 'https://example.com' }));
    const after = (await (await app.request('/site-settings')).json()) as { id: string };
    expect(before.id).toBe(after.id);
  });
});

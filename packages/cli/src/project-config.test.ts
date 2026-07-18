import { describe, it, expect } from 'vitest';
import { fixtureAppRaw } from '@sprintster/engine';
import { parseProjectConfig, selectEnvironment } from './project-config.js';

const raw = {
  configVersion: '1',
  app: fixtureAppRaw,
  environments: {
    dev: { backend: { kind: 'sqlite', path: '.sprintster/dev.db' }, server: { host: '127.0.0.1', port: 3030 } },
    prod: { backend: { kind: 'postgres', url: 'postgres://localhost/app' } },
  },
};

describe('parseProjectConfig', () => {
  it('parses a valid config and loads the app config', () => {
    const cfg = parseProjectConfig(raw);
    expect(cfg.app.objects.map((o) => o.name)).toContain('client');
    expect(cfg.environments.dev?.backend.kind).toBe('sqlite');
  });

  it('applies the server default when an environment omits it', () => {
    const cfg = parseProjectConfig(raw);
    expect(cfg.environments.prod?.server.port).toBe(3030);
    expect(cfg.environments.prod?.server.host).toBe('127.0.0.1');
  });

  it('defaults the blob dir to .sprintster/binary-data and honours an override', () => {
    const cfg = parseProjectConfig(raw);
    expect(cfg.environments.dev?.blobs.dir).toBe('.sprintster/binary-data');
    const custom = parseProjectConfig({
      ...raw,
      environments: { dev: { backend: { kind: 'sqlite', path: 'x.db' }, blobs: { dir: '/var/data/blobs' } } },
    });
    expect(custom.environments.dev?.blobs.dir).toBe('/var/data/blobs');
  });

  it('rejects an unknown configVersion', () => {
    expect(() => parseProjectConfig({ ...raw, configVersion: '2' })).toThrow();
  });

  it('rejects an unknown backend kind', () => {
    expect(() =>
      parseProjectConfig({ ...raw, environments: { dev: { backend: { kind: 'mongo' } } } }),
    ).toThrow();
  });
});

describe('selectEnvironment', () => {
  it('returns the named environment', () => {
    const cfg = parseProjectConfig(raw);
    expect(selectEnvironment(cfg, 'prod').backend.kind).toBe('postgres');
  });

  it('throws on an unknown environment', () => {
    const cfg = parseProjectConfig(raw);
    expect(() => selectEnvironment(cfg, 'staging')).toThrow(/unknown environment/);
  });
});

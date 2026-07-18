import { describe, it, expect } from 'vitest';
import { loadConfig } from '@sprintster/engine';
import { buildFiles } from './template.js';

describe('buildFiles', () => {
  it('produces an engine-valid app config with a user object (sqlite)', () => {
    const files = buildFiles({ name: 'demo', backend: 'sqlite' });
    const cfg = JSON.parse(files['sprintster.config.json']!) as { configVersion: string; app: unknown; environments: Record<string, unknown> };
    expect(cfg.configVersion).toBe('1');
    const app = loadConfig(cfg.app);
    expect(app.objects.map((o) => o.name)).toEqual(['user']);
    expect(Object.keys(cfg.environments)).toEqual(['dev']);
  });

  it('adds a postgres prod environment when chosen', () => {
    const files = buildFiles({ name: 'demo', backend: 'postgres' });
    const cfg = JSON.parse(files['sprintster.config.json']!) as { environments: Record<string, { backend: { kind: string } }> };
    expect(Object.keys(cfg.environments).sort()).toEqual(['dev', 'prod']);
    expect(cfg.environments['prod']?.backend.kind).toBe('postgres');
  });

  it('gives dev and prod distinct default ports', () => {
    const cfg = JSON.parse(buildFiles({ name: 'demo', backend: 'postgres' })['sprintster.config.json']!) as {
      environments: Record<string, { server: { port: number } }>;
    };
    expect(cfg.environments['dev']?.server.port).toBe(3939);
    expect(cfg.environments['prod']?.server.port).toBe(3030);
    expect(cfg.environments['dev']?.server.port).not.toBe(cfg.environments['prod']?.server.port);
  });

  it('generates a package.json wired to s8r with no dependencies by default', () => {
    const files = buildFiles({ name: 'my-app', backend: 'sqlite' });
    const pkg = JSON.parse(files['package.json']!) as {
      name: string;
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts['dev']).toBe('s8r dev');
    expect(pkg.dependencies).toBeUndefined();
  });

  it('adds a link: dependency on @sprintster/cli when linkCliPath is set', () => {
    const files = buildFiles({ name: 'my-app', backend: 'sqlite', linkCliPath: '/abs/repo/packages/cli' });
    const pkg = JSON.parse(files['package.json']!) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['@sprintster/cli']).toBe('link:/abs/repo/packages/cli');
  });
});

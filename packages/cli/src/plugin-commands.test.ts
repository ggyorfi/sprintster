import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pluginCommands } from './plugin-commands.js';

function project(plugins: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 's8r-plugins-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"app","type":"module"}');
  writeFileSync(
    join(dir, 'sprintster.config.json'),
    JSON.stringify({ configVersion: '1', environments: { dev: { backend: { kind: 'sqlite', path: 'x.db' } } }, app: { version: '1', objects: [], plugins } }),
  );
  const pkg = join(dir, 'node_modules', 'plugin-hello');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"name":"plugin-hello","type":"module","main":"index.js"}');
  writeFileSync(
    join(pkg, 'index.js'),
    `export const cliPlugin = { name: 'plugin-hello', namespace: 'hello', version: '1', capabilities: [],
      config: { parse: (c) => ({ who: c.who ?? 'world' }) },
      init(ctx) { ctx.cli.register({ verb: 'hello', description: 'greet', run: async (_a, run) => (globalThis.greeted = run.config.who, 0) }); } };`,
  );
  return dir;
}

describe('pluginCommands', () => {
  it("registers a project plugin's commands, each run with that plugin's config", async () => {
    const commands = await pluginCommands(project([{ name: 'plugin-hello', config: { who: 'Gabor' } }]));
    expect(Object.keys(commands)).toEqual(['hello']);
    await (commands['hello'] as { run: (ctx: { args: unknown }) => Promise<void> }).run({ args: {} });
    expect((globalThis as { greeted?: string }).greeted).toBe('Gabor');
  });

  it('has none outside a project', async () => {
    expect(await pluginCommands(mkdtempSync(join(tmpdir(), 's8r-empty-')))).toEqual({});
  });
});

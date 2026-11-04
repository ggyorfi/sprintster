import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readConfigFile } from './config-file.js';

function tree(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'config-file-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

describe('readConfigFile', () => {
  it('returns a file without extends as it is', () => {
    const root = tree({ 'a.json': { x: 1 } });
    expect(readConfigFile(join(root, 'a.json'))).toEqual({ x: 1 });
  });

  it('follows a chain, each extends relative to its own file', () => {
    const root = tree({
      'shared/base.json': { app: { title: 'Base', objects: [1] } },
      'shared/portfolio/config.json': { extends: '../base.json', app: { locales: ['en'] } },
      'site/config.json': { extends: '../shared/portfolio/config.json', app: { title: 'Site' } },
    });
    expect(readConfigFile(join(root, 'site/config.json'))).toEqual({
      app: { title: 'Site', objects: [1], locales: ['en'] },
    });
  });

  it('rebases ./ and ../ paths of the named keys against the declaring file, and leaves names alone', () => {
    const root = tree({
      'shared/config.json': { theme: './themes/portfolio', other: './x' },
      'site/config.json': { extends: '../shared/config.json' },
      'named/config.json': { extends: '../shared/config.json', theme: 'default' },
    });
    expect(readConfigFile(join(root, 'site/config.json'), ['theme'])).toEqual({
      theme: join(root, 'shared/themes/portfolio'),
      other: './x',
    });
    expect(readConfigFile(join(root, 'named/config.json'), ['theme'])).toMatchObject({ theme: 'default' });
  });

  it('rejects a cycle', () => {
    const root = tree({ 'a.json': { extends: './b.json' }, 'b.json': { extends: './a.json' } });
    expect(() => readConfigFile(join(root, 'a.json'))).toThrow(/extends itself/);
  });

  it('names the file that extends a missing one', () => {
    const root = tree({ 'a.json': { extends: './missing.json' } });
    expect(() => readConfigFile(join(root, 'a.json'))).toThrow(/missing\.json, extended by .*a\.json/);
  });
});

import { describe, it, expect } from 'vitest';
import { parseArgs, linkCliPathFrom } from './args.js';

describe('parseArgs', () => {
  it('takes the first positional as the name', () => {
    expect(parseArgs(['node', 'cs', 'my-app'])).toEqual({ name: 'my-app' });
  });

  it('reads --backend', () => {
    expect(parseArgs(['node', 'cs', 'my-app', '--backend', 'postgres'])).toEqual({
      name: 'my-app',
      backend: 'postgres',
    });
  });

  it('treats --local with no value as a boolean', () => {
    expect(parseArgs(['node', 'cs', 'my-app', '--local'])).toEqual({ name: 'my-app', local: true });
  });

  it('takes an explicit path after --local', () => {
    expect(parseArgs(['node', 'cs', 'my-app', '--local', '/repo'])).toEqual({
      name: 'my-app',
      local: true,
      localPath: '/repo',
    });
  });

  it('does not let --local swallow a following flag', () => {
    expect(parseArgs(['node', 'cs', 'my-app', '--local', '--backend', 'sqlite'])).toEqual({
      name: 'my-app',
      local: true,
      backend: 'sqlite',
    });
  });
});

describe('linkCliPathFrom', () => {
  it('appends packages/cli to an explicit repo path', () => {
    expect(linkCliPathFrom('/some/repo')).toBe('/some/repo/packages/cli');
  });

  it('derives an absolute packages/cli path when none is given', () => {
    const path = linkCliPathFrom(undefined);
    expect(path.startsWith('/')).toBe(true);
    expect(path.endsWith('/packages/cli')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { openCommand, webDistCandidates } from './web.js';

describe('openCommand', () => {
  it('uses open on macOS', () => {
    expect(openCommand('darwin', 'http://x')).toEqual({ cmd: 'open', args: ['http://x'] });
  });

  it('uses xdg-open on Linux', () => {
    expect(openCommand('linux', 'http://x')).toEqual({ cmd: 'xdg-open', args: ['http://x'] });
  });

  it('uses start via cmd on Windows', () => {
    expect(openCommand('win32', 'http://x')).toEqual({ cmd: 'cmd', args: ['/c', 'start', '', 'http://x'] });
  });
});

describe('webDistCandidates', () => {
  it('includes a vendored dir and the monorepo web dist', () => {
    const candidates = webDistCandidates();
    expect(candidates.some((p) => p.endsWith('/web'))).toBe(true);
    expect(candidates.some((p) => p.endsWith(['packages', 'web', 'dist'].join('/')))).toBe(true);
  });
});

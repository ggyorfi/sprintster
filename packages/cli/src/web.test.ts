import { describe, it, expect } from 'vitest';
import { openCommand, webDistPath } from './web.js';

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

describe('webDistPath', () => {
  it('points at the web package dist directory', () => {
    expect(webDistPath().endsWith(['packages', 'web', 'dist'].join('/'))).toBe(true);
  });
});

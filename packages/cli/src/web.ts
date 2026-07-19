import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Candidate locations for the built web bundle: vendored next to the bundled entry (published `sprintster`), then the monorepo path (dev).
export function webDistCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [resolve(here, 'web'), resolve(here, '../../..', 'packages', 'web', 'dist')];
}

export function webRootFrom(): string | undefined {
  return webDistCandidates().find((dir) => existsSync(dir));
}

export interface OpenSpec {
  cmd: string;
  args: string[];
}

export function openCommand(platform: NodeJS.Platform, url: string): OpenSpec {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  return { cmd: 'xdg-open', args: [url] };
}

export function openUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  const { cmd, args } = openCommand(platform, url);
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // opening a browser is best-effort; a headless box just gets the URL logged
  }
}

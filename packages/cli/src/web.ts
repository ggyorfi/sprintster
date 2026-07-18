import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

export function webDistPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../..', 'packages', 'web', 'dist');
}

export function webRootFrom(): string | undefined {
  const dist = webDistPath();
  return existsSync(dist) ? dist : undefined;
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

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Args {
  name?: string;
  backend?: string;
  local?: boolean;
  localPath?: string;
}

export function parseArgs(argv: ReadonlyArray<string>): Args {
  const out: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--backend') {
      const v = argv[i + 1];
      if (v !== undefined) out.backend = v;
      i++;
    } else if (a === '--local') {
      out.local = true;
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('-')) {
        out.localPath = v;
        i++;
      }
    } else if (!a.startsWith('-') && out.name === undefined) {
      out.name = a;
    }
  }
  return out;
}

export function linkCliPathFrom(explicit: string | undefined): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = explicit !== undefined ? resolve(explicit) : resolve(here, '../../..');
  return join(repoRoot, 'packages', 'cli');
}

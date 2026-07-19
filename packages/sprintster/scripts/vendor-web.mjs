import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', '..', 'web', 'dist');
const target = join(here, '..', 'dist', 'web');

if (!existsSync(webDist)) {
  console.error(`web bundle not found at ${webDist}; build @sprintster/web first`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(webDist, target, { recursive: true });
console.log(`vendored web bundle -> ${target}`);

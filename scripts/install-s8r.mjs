import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binHome =
  process.env.XDG_BIN_HOME && process.env.XDG_BIN_HOME !== ''
    ? process.env.XDG_BIN_HOME
    : join(homedir(), '.local', 'bin');
mkdirSync(binHome, { recursive: true });

const wrappers = [
  { name: 's8r', entry: join(repoRoot, 'packages/cli/dist/index.js') },
  { name: 'create-sprintster', entry: join(repoRoot, 'packages/create-sprintster/dist/index.js') },
];

for (const w of wrappers) {
  const path = join(binHome, w.name);
  writeFileSync(path, `#!/bin/sh\nexec node "${w.entry}" "$@"\n`);
  chmodSync(path, 0o755);
  console.log(`installed ${path} -> ${w.entry}`);
}

if (!(process.env.PATH ?? '').split(':').includes(binHome)) {
  console.log(`\nNote: ${binHome} is not on your PATH. Add it to run s8r / create-sprintster.`);
}

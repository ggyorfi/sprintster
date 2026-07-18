import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';

const binHome =
  process.env.XDG_BIN_HOME && process.env.XDG_BIN_HOME !== ''
    ? process.env.XDG_BIN_HOME
    : join(homedir(), '.local', 'bin');

for (const name of ['s8r', 'create-sprintster']) {
  const path = join(binHome, name);
  rmSync(path, { force: true });
  console.log(`removed ${path}`);
}

#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as p from '@clack/prompts';
import { buildFiles, type ScaffoldOptions } from './template.js';
import { parseArgs, linkCliPathFrom } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  p.intro('create-sprintster');

  let name = args.name;
  if (name === undefined) {
    const answer = await p.text({
      message: 'Project name',
      placeholder: 'my-app',
      validate: (v) => ((v ?? '').length === 0 ? 'Project name is required' : undefined),
    });
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.');
      process.exit(1);
    }
    name = answer;
  }

  let backend = args.backend;
  if (backend === undefined) {
    const answer = await p.select({
      message: 'Production backend',
      options: [
        { value: 'sqlite', label: 'SQLite (zero-infra, great for local)' },
        { value: 'postgres', label: 'PostgreSQL (adds a prod environment)' },
      ],
    });
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.');
      process.exit(1);
    }
    backend = answer;
  }
  if (backend !== 'sqlite' && backend !== 'postgres') {
    p.cancel(`Unknown backend '${backend}'.`);
    process.exit(1);
  }

  const dir = join(process.cwd(), name);
  if (existsSync(dir)) {
    p.cancel(`Directory '${name}' already exists.`);
    process.exit(1);
  }

  const options: ScaffoldOptions = { name, backend };
  if (args.local === true) options.linkCliPath = linkCliPathFrom(args.localPath);
  for (const [rel, content] of Object.entries(buildFiles(options))) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  p.outro(`Created ${name}.`);
  console.log('Next steps:\n');
  console.log(`  cd ${name}`);
  console.log('  pnpm install');
  console.log('  pnpm dev\n');
}

void main();

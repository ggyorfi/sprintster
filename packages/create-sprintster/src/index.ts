#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { buildFiles, type ScaffoldOptions } from './template.js';

interface Args {
  name?: string;
  backend?: string;
  local?: boolean;
  localPath?: string;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
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

function linkCliPathFrom(explicit: string | undefined): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = explicit !== undefined ? resolve(explicit) : resolve(here, '../../..');
  return join(repoRoot, 'packages', 'cli');
}

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

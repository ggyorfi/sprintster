#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { version } from '@sprintster/engine';
import { devCommand } from './commands/dev.js';
import { daemonCommand } from './commands/daemon.js';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from './project-config.js';
import { startTui } from './runtime.js';

function isBareInvocation(argv: ReadonlyArray<string>): boolean {
  return argv.length <= 2;
}

async function main(): Promise<void> {
  if (isBareInvocation(process.argv)) {
    const project = loadProjectConfig(projectConfigPath());
    const environment = selectEnvironment(project, 'dev');
    const daemonUrl = `http://${environment.server.host}:${environment.server.port}`;
    await startTui({ config: project.app, daemonUrl });
    return;
  }

  const root = defineCommand({
    meta: { name: 's8r', version, description: 'sprintster CLI' },
    subCommands: {
      dev: devCommand,
      daemon: daemonCommand,
    },
  });
  await runMain(root);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

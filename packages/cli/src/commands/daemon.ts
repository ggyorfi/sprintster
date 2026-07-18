import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon } from '../runtime.js';

export const daemonCommand = defineCommand({
  meta: { name: 'daemon', description: 'Run only the daemon (foreground)' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
  },
  async run({ args }) {
    const project = loadProjectConfig(projectConfigPath());
    const environment = selectEnvironment(project, args.env);
    const backend = await openBackend(environment.backend);
    await startDaemon({
      config: project.app,
      store: backend.store,
      host: environment.server.host,
      port: environment.server.port,
    });
    console.log(
      `sprintster daemon (${args.env}) on http://${environment.server.host}:${environment.server.port}`,
    );
    await new Promise(() => {});
  },
});

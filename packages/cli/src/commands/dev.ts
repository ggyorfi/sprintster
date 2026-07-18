import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon, startTui } from '../runtime.js';

export const devCommand = defineCommand({
  meta: { name: 'dev', description: 'Run the daemon and TUI against an environment' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
  },
  async run({ args }) {
    const project = loadProjectConfig(projectConfigPath());
    const environment = selectEnvironment(project, args.env);
    const backend = await openBackend(environment.backend);
    const daemon = await startDaemon({
      config: project.app,
      store: backend.store,
      host: environment.server.host,
      port: environment.server.port,
    });
    const daemonUrl = `http://${environment.server.host}:${environment.server.port}`;
    try {
      await startTui({ config: project.app, daemonUrl });
    } finally {
      await daemon.close();
      await backend.close();
    }
  },
});

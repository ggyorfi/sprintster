import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon, startTui, type DaemonHandle } from '../runtime.js';
import { failClean } from '../fail.js';

export const devCommand = defineCommand({
  meta: { name: 'dev', description: 'Run the daemon and TUI against an environment' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend);
      let daemon: DaemonHandle;
      try {
        daemon = await startDaemon({
          config: project.app,
          store: backend.store,
          host: environment.server.host,
          port: environment.server.port,
        });
      } catch (err) {
        await backend.close();
        throw err;
      }
      const daemonUrl = `http://${environment.server.host}:${environment.server.port}`;
      try {
        await startTui({ config: project.app, daemonUrl });
      } finally {
        await daemon.close();
        await backend.close();
      }
    } catch (err) {
      failClean(err);
    }
  },
});

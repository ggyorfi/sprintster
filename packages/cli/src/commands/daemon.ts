import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon } from '../runtime.js';
import { failClean } from '../fail.js';

export const daemonCommand = defineCommand({
  meta: { name: 'daemon', description: 'Run only the daemon (foreground)' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend);
      try {
        await startDaemon({
          config: project.app,
          store: backend.store,
          host: environment.server.host,
          port: environment.server.port,
        });
      } catch (err) {
        await backend.close();
        throw err;
      }
      console.log(
        `sprintster daemon (${args.env}) on http://${environment.server.host}:${environment.server.port}`,
      );
      await new Promise(() => {});
    } catch (err) {
      failClean(err);
    }
  },
});

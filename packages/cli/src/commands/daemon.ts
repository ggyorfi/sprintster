import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon } from '../runtime.js';
import { webRootFrom } from '../web.js';
import { failClean } from '../fail.js';

export const daemonCommand = defineCommand({
  meta: { name: 'daemon', description: 'Run only the daemon (API + web GUI, foreground)' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend);
      const webRoot = webRootFrom();
      try {
        await startDaemon({
          config: project.app,
          store: backend.store,
          host: environment.server.host,
          port: environment.server.port,
          ...(webRoot !== undefined ? { webRoot } : {}),
        });
      } catch (err) {
        await backend.close();
        throw err;
      }
      const where = `http://${environment.server.host}:${environment.server.port}`;
      const suffix = webRoot !== undefined ? ' (API + web GUI)' : ' (API only; web bundle not built)';
      console.log(`sprintster daemon (${args.env}) on ${where}${suffix}`);
      await new Promise(() => {});
    } catch (err) {
      failClean(err);
    }
  },
});

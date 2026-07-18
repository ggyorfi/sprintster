import { defineCommand } from 'citty';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { startDaemon, startTui, type DaemonHandle } from '../runtime.js';
import { webRootFrom, openUrl } from '../web.js';
import { failClean } from '../fail.js';

export const devCommand = defineCommand({
  meta: { name: 'dev', description: 'Run the daemon (API + web GUI) and the TUI, opening the GUI in a browser' },
  args: {
    env: { type: 'string', description: 'environment to run', default: 'dev' },
    open: { type: 'boolean', description: 'open the web GUI in the default browser', default: true },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend, environment.blobs.dir);
      const webRoot = webRootFrom();
      let daemon: DaemonHandle;
      try {
        daemon = await startDaemon({
          config: project.app,
          store: backend.store,
          blobStore: backend.blobStore,
          host: environment.server.host,
          port: environment.server.port,
          ...(webRoot !== undefined ? { webRoot } : {}),
        });
      } catch (err) {
        await backend.close();
        throw err;
      }
      const daemonUrl = `http://${environment.server.host}:${environment.server.port}`;
      if (webRoot !== undefined && args.open) openUrl(daemonUrl);
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

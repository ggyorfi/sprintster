import { defineCommand } from 'citty';
import { rebuildObjectStates } from '@sprintster/engine';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { failClean } from '../fail.js';

export const rebuildStatesCommand = defineCommand({
  meta: {
    name: 'rebuild-states',
    description: "Refold every record from the event log into the store's current-state table",
  },
  args: {
    env: { type: 'string', description: 'environment to rebuild', default: 'dev' },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend, environment.blobs.dir);
      try {
        for (const obj of project.app.objects) await rebuildObjectStates(backend.store, obj);
        console.log(`rebuilt the states of ${project.app.objects.length} objects (${args.env})`);
      } finally {
        await backend.close();
      }
    } catch (err) {
      failClean(err);
    }
  },
});

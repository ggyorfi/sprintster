import { createWorker } from '../src/index.js';

const { App, worker } = createWorker({
  app: {
    version: '1',
    objects: [
      {
        name: 'note',
        title: 'Note',
        titlePlural: 'Notes',
        route: 'notes',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'title', title: 'Title', type: 'text' },
          { name: 'removed', type: 'boolean', system: true },
        ],
      },
    ],
  },
});

export { App };
export default worker;

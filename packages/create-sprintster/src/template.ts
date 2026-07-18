export interface ScaffoldOptions {
  name: string;
  backend: 'sqlite' | 'postgres';
  linkCliPath?: string;
}

const userObject = {
  name: 'user',
  title: 'User',
  titlePlural: 'Users',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', title: 'Name', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'email', title: 'Email', type: 'text', nullable: true },
    { name: 'role', title: 'Role', type: 'enum', values: ['admin', 'member', 'guest'], default: 'member' },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Users',
      columns: [
        { property: 'id', label: 'ID', width: 10 },
        { property: 'name', label: 'Name', width: 30 },
        { property: 'email', label: 'Email', width: 30 },
        { property: 'role', label: 'Role', width: 12 },
      ],
      search: { fields: ['name', 'email', 'role'], idPrefix: true },
      actions: [
        { hotkey: 'n', label: 'new', kind: 'create', view: 'default' },
        { hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' },
        { hotkey: 'v', label: 'view', kind: 'view', view: 'default' },
        { hotkey: 'd', label: 'del', kind: 'delete' },
      ],
    },
  ],
  views: [
    {
      name: 'default',
      title: 'User',
      fields: [
        { property: 'name', placeholder: 'e.g. Ada Lovelace' },
        { property: 'email', placeholder: 'e.g. ada@example.com' },
        { property: 'role' },
      ],
    },
  ],
};

function environments(backend: 'sqlite' | 'postgres'): Record<string, unknown> {
  const envs: Record<string, unknown> = {
    dev: {
      backend: { kind: 'sqlite', path: '.sprintster/dev.db' },
      server: { host: '127.0.0.1', port: 3939 },
    },
  };
  if (backend === 'postgres') {
    envs['prod'] = {
      backend: { kind: 'postgres', url: 'postgres://localhost:5432/CHANGEME' },
      server: { host: '127.0.0.1', port: 3030 },
    };
  }
  return envs;
}

function projectPackageJson(name: string, linkCliPath?: string): unknown {
  const base = {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { dev: 's8r dev', daemon: 's8r daemon', start: 's8r' },
  };
  if (linkCliPath === undefined) return base;
  return { ...base, dependencies: { '@sprintster/cli': `link:${linkCliPath}` } };
}

function readme(name: string): string {
  return [
    `# ${name}`,
    '',
    'A sprintster project.',
    '',
    '## Run',
    '',
    '```',
    's8r dev      # start the daemon and the terminal UI',
    's8r daemon   # start only the daemon',
    '```',
    '',
    'Edit `sprintster.config.json` to change objects, fields, and environments.',
    '',
  ].join('\n');
}

export function buildFiles(opts: ScaffoldOptions): Record<string, string> {
  const config = {
    configVersion: '1',
    environments: environments(opts.backend),
    app: { version: '1', objects: [userObject] },
  };
  return {
    'sprintster.config.json': `${JSON.stringify(config, null, 2)}\n`,
    'package.json': `${JSON.stringify(projectPackageJson(opts.name, opts.linkCliPath), null, 2)}\n`,
    '.gitignore': ['.sprintster/', 'node_modules/', ''].join('\n'),
    'README.md': readme(opts.name),
  };
}

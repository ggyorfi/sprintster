import { defineCommand, type CommandDef } from 'citty';
import { loadPlugins, type CliCommand, type CliPlugin, type CliPluginContext } from '@sprintster/engine';
import { consoleLogger } from '@sprintster/daemon';
import { loadProjectConfig, projectConfigPath } from './project-config.js';
import { nodePluginResolver } from './runtime.js';

// Commands from the project's plugins; a CLI run outside a project has none.
export async function pluginCommands(projectDir: string): Promise<Record<string, CommandDef>> {
  let plugins;
  try {
    plugins = loadProjectConfig(projectConfigPath(projectDir)).app.plugins;
  } catch {
    return {};
  }
  const commands: Array<{ command: CliCommand; config: unknown }> = [];
  const resolve = nodePluginResolver(projectDir);
  await loadPlugins<CliPluginContext>({
    entries: plugins,
    logger: consoleLogger,
    resolve: async (name) => {
      const { cliPlugin } = (await resolve(name)) as { cliPlugin?: CliPlugin };
      return cliPlugin === undefined ? null : { plugin: cliPlugin };
    },
    buildContext: (_entry, _namespace, config) => ({
      config,
      logger: consoleLogger,
      cli: { register: (command) => commands.push({ command, config }) },
    }),
  });
  return Object.fromEntries(
    commands.map(({ command, config }) => [
      command.verb,
      defineCommand({
        meta: { name: command.verb, description: command.description },
        async run({ args }) {
          const parsed = command.args === undefined ? args : command.args.parse(args);
          process.exitCode = await command.run(parsed, { logger: consoleLogger, config });
        },
      }),
    ]),
  );
}

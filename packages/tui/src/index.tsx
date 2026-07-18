import React from 'react';
import { render } from 'ink';
import { createApiClient, setAppConfig, type Config } from '@sprintster/engine';
import { App } from './App.js';
import { refreshTheme } from './theme.js';

const ALT_ENTER = '\x1b[?1049h';
const ALT_LEAVE = '\x1b[?1049l';

let restored = false;
function restoreScreen(): void {
  if (restored) return;
  restored = true;
  process.stdout.write(ALT_LEAVE);
}

let signalsBound = false;
function bindSignals(): void {
  if (signalsBound) return;
  signalsBound = true;
  process.on('exit', restoreScreen);
  process.on('SIGINT', () => {
    restoreScreen();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    restoreScreen();
    process.exit(143);
  });
}

export interface RunTuiOptions {
  daemonUrl: string;
  config: Config;
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  bindSignals();
  process.stdout.write(ALT_ENTER);
  try {
    setAppConfig(opts.config);
    refreshTheme();
    const apiClient = createApiClient(opts.daemonUrl);

    const instance = render(
      <App apiClient={apiClient} daemonUrl={opts.daemonUrl} />,
      { exitOnCtrlC: false },
    );
    await instance.waitUntilExit();
  } finally {
    restoreScreen();
  }
}

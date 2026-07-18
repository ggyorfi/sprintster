import { createRoot } from 'react-dom/client';
import { appConfig } from '@sprintster/engine';
import './theme/tokens.css';
import { applyConfigTheme } from './theme/applyConfigTheme.js';
import { resolveApiBaseUrl } from './api/config.js';
import { loadServerConfig } from './app/bootstrap.js';
import { App } from './app/App.js';

async function boot() {
  await loadServerConfig(resolveApiBaseUrl());
  applyConfigTheme(appConfig.theme as Record<string, string | undefined>);
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<App />);
}

void boot();

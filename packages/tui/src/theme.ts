import { appConfig } from '@sprintster/engine';

export let THEME = appConfig.theme;

export function refreshTheme(): void {
  THEME = appConfig.theme;
}

/*
 * Bridges the engine's config theme (appConfig.theme) onto the web CSS custom
 * properties in tokens.css. Two guards keep the TUI-tuned config from degrading
 * the web palette:
 *   1. Only WEB-valid colours (hex / rgb / hsl / color-mix) override a token; a
 *      terminal-only chalk name like 'blue' or 'gray' is ignored.
 *   2. Only polarity-independent HUE tokens are bridged (accent, error,
 *      highlight). Surface tokens (bg / field / text) stay owned by tokens.css,
 *      because the config carries dark-terminal surfaces (e.g. fieldBgColor
 *      '#202020') that must not paint a light web page.
 */

type ThemeLike = Record<string, string | undefined>;

const CONFIG_TO_CSS: Record<string, string> = {
  accentColor: '--accent',
  errorColor: '--red',
  highlightColor: '--highlight',
};

export function isWebColor(value: string): boolean {
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^(rgb|hsl|color-mix)\(/i.test(value);
}

export function configToCssVars(theme: ThemeLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [configKey, cssVar] of Object.entries(CONFIG_TO_CSS)) {
    const value = theme[configKey];
    if (value !== undefined && isWebColor(value)) out[cssVar] = value;
  }
  return out;
}

export function applyConfigTheme(theme: ThemeLike, el: HTMLElement = document.documentElement): void {
  const vars = configToCssVars(theme);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
}

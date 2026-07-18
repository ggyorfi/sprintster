import { describe, it, expect } from 'vitest';
import { isWebColor, configToCssVars, applyConfigTheme } from './applyConfigTheme.js';

describe('configToCssVars', () => {
  it('maps hex config tokens onto css variables', () => {
    const vars = configToCssVars({ accentColor: '#7c3aed', errorColor: '#cf322d' });
    expect(vars['--accent']).toBe('#7c3aed');
    expect(vars['--red']).toBe('#cf322d');
  });

  it('ignores terminal-only colour names so the web default survives', () => {
    const vars = configToCssVars({ accentColor: 'blue', mutedColor: 'gray', bgColor: 'default' });
    expect(vars['--accent']).toBeUndefined();
    expect(vars['--muted']).toBeUndefined();
    expect(vars['--bg']).toBeUndefined();
  });

  it('does not bridge dark-terminal surface tokens onto the light web page', () => {
    const vars = configToCssVars({ fieldBgColor: '#202020', bgColor: '#101010', textColor: '#ffffff' });
    expect(vars['--field']).toBeUndefined();
    expect(vars['--bg']).toBeUndefined();
    expect(vars['--text']).toBeUndefined();
  });
});

describe('isWebColor', () => {
  it('accepts hex and css colour functions, rejects chalk names', () => {
    expect(isWebColor('#202020')).toBe(true);
    expect(isWebColor('rgb(0,0,0)')).toBe(true);
    expect(isWebColor('color-mix(in srgb, red 50%, white)')).toBe(true);
    expect(isWebColor('blue')).toBe(false);
    expect(isWebColor('default')).toBe(false);
  });
});

describe('applyConfigTheme', () => {
  it('writes web-valid overrides as inline custom properties', () => {
    const el = document.createElement('div');
    applyConfigTheme({ accentColor: '#123456', mutedColor: 'gray' }, el);
    expect(el.style.getPropertyValue('--accent')).toBe('#123456');
    expect(el.style.getPropertyValue('--muted')).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { loadConfig } from './loader.js';
import { fixtureAppRaw } from './fixture.js';

const example = fixtureAppRaw as unknown;

function clone(): any {
  return JSON.parse(JSON.stringify(example));
}

describe('loadConfig: the canonical default', () => {
  it('loads DEFAULT_APP_CONFIG_RAW and exposes its objects', () => {
    const config = loadConfig(example);
    expect(config.version).toBe('1');
    expect(config.objects.map((o) => o.name)).toEqual(['client', 'memo']);
  });
});

describe('loadConfig: theme', () => {
  it('keeps an explicit theme palette', () => {
    const config = loadConfig(example);
    expect(config.theme.accentColor).toBe('blue');
    expect(config.theme.fieldBgColor).toBe('#202020');
  });

  it('resolves the full palette (widget tokens inherit base) when theme is omitted', () => {
    const bare = clone();
    delete bare.theme;
    const config = loadConfig(bare);
    expect(config.theme).toEqual({
      bgColor: 'default',
      textColor: 'white',
      accentColor: 'blue',
      mutedColor: 'gray',
      highlightColor: 'yellow',
      errorColor: 'red',
      selectedBgColor: 'blue',
      selectedTextColor: 'black',
      fieldBgColor: '#202020',
      fieldTextColor: 'white',
      disabledBgColor: 'default',
      disabledTextColor: 'gray',
      navBgColor: 'blue',
      navTextColor: 'black',
      navSelectedBgColor: 'black',
      navSelectedTextColor: 'blue',
      buttonBgColor: 'gray',
      buttonTextColor: 'white',
      buttonActiveBgColor: 'blue',
      buttonActiveTextColor: 'black',
      buttonDisabledBgColor: 'default',
      buttonDisabledTextColor: 'gray',
      fieldDisabledBgColor: 'default',
      fieldDisabledTextColor: 'gray',
      cursorBgColor: 'white',
      cursorTextColor: '#202020',
    });
  });

  it('lets a widget token override its inherited default', () => {
    const custom = clone();
    custom.theme.navSelectedBgColor = 'magenta';
    const config = loadConfig(custom);
    expect(config.theme.navSelectedBgColor).toBe('magenta');
    expect(config.theme.navBgColor).toBe('blue'); // still inherits accent
  });

  it('rejects an unknown theme key (strict)', () => {
    const bad = clone();
    bad.theme.glow = 'pink';
    expect(() => loadConfig(bad)).toThrow();
  });
});

describe('loadConfig: structural validation', () => {
  it('rejects an unknown property type', () => {
    const bad = clone();
    bad.objects[0].properties[1].type = 'colour';
    expect(() => loadConfig(bad)).toThrow();
  });

  it('rejects an enum property without values', () => {
    const bad = clone();
    delete bad.objects[0].properties[2].values;
    expect(() => loadConfig(bad)).toThrow();
  });

  it('rejects an unknown top-level key (strict)', () => {
    const bad = clone();
    bad.extra = true;
    expect(() => loadConfig(bad)).toThrow();
  });

  it('rejects an unknown version', () => {
    const bad = clone();
    bad.version = '2';
    expect(() => loadConfig(bad)).toThrow();
  });
});

describe('loadConfig: semantic validation', () => {
  it('rejects duplicate object names', () => {
    const bad = clone();
    bad.objects[1].name = 'client';
    expect(() => loadConfig(bad)).toThrow(/duplicate/i);
  });

  it('rejects duplicate property names within an object', () => {
    const bad = clone();
    bad.objects[0].properties[2].name = 'name';
    expect(() => loadConfig(bad)).toThrow(/duplicate/i);
  });

  it('rejects an enum default that is not one of its values', () => {
    const bad = clone();
    bad.objects[0].properties[2].default = 'wizard';
    expect(() => loadConfig(bad)).toThrow(/default/i);
  });

  it('rejects a ref whose target is not a known object', () => {
    const bad = clone();
    bad.objects[1].properties[1].target = 'nonexistent';
    expect(() => loadConfig(bad)).toThrow(/target/i);
  });

  it('rejects a lifecycle field that is not a property', () => {
    const bad = clone();
    bad.objects[0].lifecycle = { softDelete: 'ghost' };
    expect(() => loadConfig(bad)).toThrow(/lifecycle/i);
  });
});

describe('loadConfig: command (transition) validation', () => {
  function withCommands(commands: unknown): unknown {
    return {
      version: '1',
      objects: [
        {
          name: 'thing',
          title: 'Thing',
          titlePlural: 'Things',
          lifecycle: { statusField: 'status' },
          properties: [
            { name: 'id', type: 'id', strategy: 'uuid', system: true },
            { name: 'status', type: 'enum', values: ['live', 'cancelled', 'paid'], default: 'live' },
          ],
          lists: [{ name: 'default', title: 'Things', columns: [{ property: 'id' }] }],
          views: [{ name: 'default', title: 'Thing', fields: [{ property: 'status' }] }],
          commands,
        },
      ],
    };
  }

  it('accepts a transition whose from/to are values of the statusField enum', () => {
    expect(() => loadConfig(withCommands([{ name: 'cancel', transition: { from: ['live'], to: 'cancelled' } }]))).not.toThrow();
  });

  it('rejects a from-state that is not a value of the statusField', () => {
    expect(() => loadConfig(withCommands([{ name: 'cancel', transition: { from: ['draft'], to: 'cancelled' } }]))).toThrow(
      /from-state/i,
    );
  });

  it('rejects a to-state that is not a value of the statusField', () => {
    expect(() => loadConfig(withCommands([{ name: 'archive', transition: { from: ['live'], to: 'archived' } }]))).toThrow(
      /to-state/i,
    );
  });

  it('rejects duplicate command names', () => {
    expect(() =>
      loadConfig(
        withCommands([
          { name: 'cancel', transition: { from: ['live'], to: 'cancelled' } },
          { name: 'cancel', transition: { from: ['paid'], to: 'cancelled' } },
        ]),
      ),
    ).toThrow(/duplicate command/i);
  });

  it('rejects commands on a softDelete object', () => {
    const bad: any = withCommands([{ name: 'cancel', transition: { from: ['live'], to: 'cancelled' } }]);
    bad.objects[0].lifecycle = { softDelete: 'status' };
    bad.objects[0].properties[1] = { name: 'status', type: 'boolean', system: true };
    expect(() => loadConfig(bad)).toThrow(/statusField/i);
  });
});

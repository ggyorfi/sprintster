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

describe('loadConfig: unique validation guard', () => {
  function rawWith(prop: unknown): unknown {
    return {
      version: '1',
      objects: [
        {
          name: 'page',
          title: 'Page',
          titlePlural: 'Pages',
          lifecycle: { softDelete: 'removed' },
          properties: [
            { name: 'id', type: 'id', strategy: 'uuid', system: true },
            prop,
            { name: 'removed', type: 'boolean', system: true },
          ],
          lists: [],
        },
      ],
    };
  }

  it('accepts unique on a top-level scalar field', () => {
    expect(() => loadConfig(rawWith({ name: 'slug', type: 'text', validation: { required: true, unique: true } }))).not.toThrow();
  });

  it('rejects unique on an object field', () => {
    expect(() =>
      loadConfig(rawWith({ name: 'addr', type: 'object', properties: [{ name: 'x', type: 'text' }], validation: { unique: true } })),
    ).toThrow(/unique/);
  });

  it('rejects unique on an array field', () => {
    expect(() =>
      loadConfig(
        rawWith({ name: 'tags', type: 'array', item: { properties: [{ name: 'v', type: 'text' }] }, validation: { unique: true } }),
      ),
    ).toThrow(/unique/);
  });

  it('rejects unique on a nested property', () => {
    expect(() =>
      loadConfig(
        rawWith({ name: 'addr', type: 'object', properties: [{ name: 'x', type: 'text', validation: { unique: true } }] }),
      ),
    ).toThrow(/unique/);
  });

  it('rejects unique on a sequence field', () => {
    expect(() => loadConfig(rawWith({ name: 'seq', type: 'sequence', validation: { unique: true } }))).toThrow(/unique/);
  });

  it('rejects unique on a refs field', () => {
    expect(() => loadConfig(rawWith({ name: 'tags', type: 'refs', target: 'page', validation: { unique: true } }))).toThrow(/unique/);
  });

  it('accepts caseInsensitive alongside unique', () => {
    expect(() =>
      loadConfig(rawWith({ name: 'slug', type: 'text', validation: { unique: true, caseInsensitive: true } })),
    ).not.toThrow();
  });

  it('rejects caseInsensitive without unique', () => {
    expect(() => loadConfig(rawWith({ name: 'slug', type: 'text', validation: { caseInsensitive: true } }))).toThrow(/caseInsensitive/);
  });
});

describe('loadConfig: code and markdown property options', () => {
  function rawWith(props: unknown[]): unknown {
    return {
      version: '1',
      objects: [
        {
          name: 'page',
          title: 'Page',
          titlePlural: 'Pages',
          lifecycle: { softDelete: 'removed' },
          properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, ...props, { name: 'removed', type: 'boolean', system: true }],
          lists: [],
        },
      ],
    };
  }

  it('accepts a code language and a markdown editor mode', () => {
    const c = loadConfig(rawWith([{ name: 'snippet', type: 'code', language: 'json' }, { name: 'body', type: 'markdown', editor: 'combo' }]));
    const props = c.objects[0]!.properties;
    expect(props.find((p) => p.name === 'snippet')).toMatchObject({ type: 'code', language: 'json' });
    expect(props.find((p) => p.name === 'body')).toMatchObject({ type: 'markdown', editor: 'combo' });
  });

  it('rejects an unknown markdown editor mode', () => {
    expect(() => loadConfig(rawWith([{ name: 'body', type: 'markdown', editor: 'fancy' }]))).toThrow();
  });
});

describe('loadConfig: singleton objects', () => {
  function singletonRaw(props: unknown[]): unknown {
    const names = (props as Array<{ name: string; type: string }>).filter((p) => p.type !== 'id').map((p) => p.name);
    return {
      version: '1',
      objects: [
        {
          name: 'settings',
          title: 'Settings',
          titlePlural: 'Settings',
          singleton: true,
          properties: props,
          views: [{ name: 'default', title: 'Settings', fields: names.map((n) => ({ property: n })) }],
        },
      ],
    };
  }

  it('loads a singleton with no lifecycle and defaults its lists to empty', () => {
    const c = loadConfig(
      singletonRaw([
        { name: 'siteName', type: 'text', default: 'My Site' },
        { name: 'tagline', type: 'text', nullable: true },
        { name: 'itemsPerPage', type: 'integer', default: 10 },
        { name: 'tags', type: 'refs', target: 'settings' },
      ]),
    );
    expect(c.objects[0]?.singleton).toBe(true);
    expect(c.objects[0]?.lifecycle).toBeUndefined();
    expect(c.objects[0]?.lists).toEqual([]);
  });

  it('rejects a singleton with no view, which would render an empty form', () => {
    const raw = singletonRaw([{ name: 'siteName', type: 'text', default: 'My Site' }]) as {
      objects: Array<{ views?: unknown }>;
    };
    delete raw.objects[0]!.views;
    expect(() => loadConfig(raw)).toThrow(/must declare a view/);
  });

  it('rejects a required singleton field with no default', () => {
    expect(() => loadConfig(singletonRaw([{ name: 'siteName', type: 'text', validation: { required: true } }]))).toThrow(
      /required but has no default/,
    );
  });

  it('accepts a non-nullable singleton field without a default; it projects to a zero value', () => {
    expect(() => loadConfig(singletonRaw([{ name: 'enabled', type: 'boolean' }]))).not.toThrow();
    expect(() => loadConfig(singletonRaw([{ name: 'baseUrl', type: 'text' }]))).not.toThrow();
  });

  it('requires a lifecycle for non-singleton objects', () => {
    const raw = {
      version: '1',
      objects: [
        {
          name: 'thing',
          title: 'Thing',
          titlePlural: 'Things',
          properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }],
          lists: [],
        },
      ],
    };
    expect(() => loadConfig(raw)).toThrow(/lifecycle/);
  });
});

describe('loadConfig: refs target validation', () => {
  function rawWithRefs(target: string): unknown {
    return {
      version: '1',
      objects: [
        {
          name: 'post',
          title: 'Post',
          titlePlural: 'Posts',
          lifecycle: { softDelete: 'removed' },
          properties: [
            { name: 'id', type: 'id', strategy: 'uuid', system: true },
            { name: 'tags', type: 'refs', target },
            { name: 'removed', type: 'boolean', system: true },
          ],
          lists: [],
        },
      ],
    };
  }

  it('accepts a refs field whose target is a self-reference', () => {
    expect(() => loadConfig(rawWithRefs('post'))).not.toThrow();
  });

  it('rejects a refs field whose target is not a known object', () => {
    expect(() => loadConfig(rawWithRefs('nope'))).toThrow(/target/);
  });
});

describe('loadConfig: object routes', () => {
  function rawWithObjects(...objects: Array<Record<string, unknown>>): unknown {
    return {
      version: '1',
      objects: objects.map((o) => ({
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'removed', type: 'boolean', system: true },
        ],
        lists: [],
        ...o,
      })),
    };
  }

  it('resolves a route on every object', () => {
    const config = loadConfig(
      rawWithObjects({ name: 'settings', title: 'Site Setting', titlePlural: 'Site Settings' }),
    );
    expect(config.objects[0]?.route).toBe('site-settings');
  });

  it('keeps an explicit route', () => {
    const config = loadConfig(
      rawWithObjects({ name: 'settings', title: 'Site Setting', titlePlural: 'Site Settings', route: 'config-panel' }),
    );
    expect(config.objects[0]?.route).toBe('config-panel');
  });

  it('is idempotent across a reload of its own output', () => {
    const once = loadConfig(rawWithObjects({ name: 'settings', title: 'Site Setting', titlePlural: 'Site Settings' }));
    expect(loadConfig(once).objects[0]?.route).toBe('site-settings');
  });

  it('rejects two objects that slug to the same route', () => {
    expect(() =>
      loadConfig(
        rawWithObjects(
          { name: 'settings', title: 'Site Setting', titlePlural: 'Site Settings' },
          { name: 'siteSettings', title: 'Site-Setting', titlePlural: 'Site-Settings' },
        ),
      ),
    ).toThrow(/duplicate object route 'site-settings'/);
  });

  it('rejects an explicit route colliding with a derived one', () => {
    expect(() =>
      loadConfig(
        rawWithObjects(
          { name: 'page', title: 'Page', titlePlural: 'Pages' },
          { name: 'article', title: 'Article', titlePlural: 'Articles', route: 'pages' },
        ),
      ),
    ).toThrow(/duplicate object route 'pages'/);
  });

  it.each(['health', 'config', 'assets'])('rejects the daemon-reserved route %s', (route) => {
    expect(() => loadConfig(rawWithObjects({ name: 'thing', title: 'Thing', titlePlural: 'Things', route }))).toThrow(
      /reserved by the daemon/,
    );
  });

  it('rejects a reserved route reached by slugifying the label', () => {
    expect(() => loadConfig(rawWithObjects({ name: 'setting', title: 'Config', titlePlural: 'Config' }))).toThrow(
      /reserved by the daemon/,
    );
  });

  it('rejects a label that slugs to nothing', () => {
    expect(() => loadConfig(rawWithObjects({ name: 'thing', title: 'Thing', titlePlural: '...' }))).toThrow(
      /slugs to nothing/,
    );
  });

  it('rejects an explicit route that is not already a slug', () => {
    expect(() =>
      loadConfig(rawWithObjects({ name: 'settings', title: 'Site Setting', titlePlural: 'Site Settings', route: 'Site Settings' })),
    ).toThrow(/is not a slug; use 'site-settings'/);
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

describe('loadConfig: assets', () => {
  const assetObject = {
    name: 'asset',
    title: 'Asset',
    titlePlural: 'Assets',
    // 'assets' is reserved by the daemon for the blob route, so an asset object needs an explicit one.
    route: 'media',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'file', type: 'image', title: 'File' },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Assets', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
  };

  function withBody(images: boolean | undefined) {
    const raw = clone();
    const prop: Record<string, unknown> = { name: 'body', type: 'markdown', title: 'Body' };
    if (images !== undefined) prop['images'] = images;
    raw.objects[0].properties.push(prop);
    return raw;
  }

  it('loads a config that asks for neither assets nor in-body images', () => {
    expect(() => loadConfig(withBody(undefined))).not.toThrow();
    expect(() => loadConfig(withBody(false))).not.toThrow();
  });

  it('refuses in-body images when no assets object is named, and says what to define', () => {
    expect(() => loadConfig(withBody(true))).toThrow(/asks for in-body images/);
    expect(() => loadConfig(withBody(true))).toThrow(/set 'assets' to its name/);
    expect(() => loadConfig(withBody(true))).toThrow(/objects-and-properties\.md#assets/);
  });

  it('accepts in-body images once an assets object is named', () => {
    const raw = withBody(true);
    raw.objects.push(assetObject);
    raw.assets = 'asset';
    expect(() => loadConfig(raw)).not.toThrow();
  });

  it('refuses an assets name that matches no object', () => {
    const raw = clone();
    raw.assets = 'nope';
    expect(() => loadConfig(raw)).toThrow(/names unknown object 'nope'/);
    expect(() => loadConfig(raw)).toThrow(/objects-and-properties\.md#assets/);
  });

  it('refuses an assets object with no image property to hold the file', () => {
    const raw = clone();
    raw.objects.push({ ...assetObject, properties: assetObject.properties.filter((p) => p.type !== 'image') });
    raw.assets = 'asset';
    expect(() => loadConfig(raw)).toThrow(/has no image property/);
  });

  it('refuses an assets object with more than one image property, since /assets/<id> must know which to serve', () => {
    const raw = clone();
    raw.objects.push({
      ...assetObject,
      properties: [...assetObject.properties, { name: 'thumbnail', type: 'image', title: 'Thumbnail' }],
    });
    raw.assets = 'asset';
    expect(() => loadConfig(raw)).toThrow(/has 2 image properties/);
    expect(() => loadConfig(raw)).toThrow(/'file', 'thumbnail'/);
  });

  it('keeps the assets name on the loaded config', () => {
    const raw = clone();
    raw.objects.push(assetObject);
    raw.assets = 'asset';
    expect(loadConfig(raw).assets).toBe('asset');
  });
});

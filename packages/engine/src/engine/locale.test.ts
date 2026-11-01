import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config/loader.js';
import { appConfig, setAppConfig } from '../config/app-config.js';
import { compileCreateSchema } from '../config/compile.js';
import type { Config } from '../config/schema.js';
import { assembleValues } from './view.js';
import { formatCell, filterByConfig } from './list.js';
import { synthesizeSingleton } from './singleton.js';
import { assembleTranslated, displayText, translatedInputs } from './locale.js';

const raw = (props: unknown[], extra: Record<string, unknown> = { locales: ['en', 'hu'] }) => ({
  version: '1',
  ...extra,
  objects: [
    {
      name: 'work',
      title: 'Work',
      titlePlural: 'Works',
      route: 'works',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        ...props,
        { name: 'removed', type: 'boolean', system: true },
      ],
      views: [{ name: 'default', title: 'Work', fields: [{ property: 'title' }] }],
    },
  ],
});

const title = { name: 'title', type: 'text', translated: true, validation: { required: true } };

describe('translated config', () => {
  it('needs a locales list', () => {
    expect(() => loadConfig(raw([title], {}))).toThrow(/needs a top-level 'locales'/);
  });

  it('refuses duplicate locales, unique and defaults', () => {
    expect(() => loadConfig(raw([title], { locales: ['en', 'en'] }))).toThrow(/duplicate locale/);
    expect(() => loadConfig(raw([{ ...title, validation: { unique: true } }]))).toThrow(/cannot be unique/);
    expect(() => loadConfig(raw([{ ...title, default: { en: 'x' } }]))).toThrow(/cannot declare a default/);
  });

  it('refuses a translated property inside an object', () => {
    const nested = { name: 'meta', type: 'object', properties: [{ name: 'note', type: 'text', translated: true }] };
    expect(() => loadConfig(raw([title, nested]))).toThrow(/is nested/);
  });

  it('is not accepted on other types', () => {
    expect(() => loadConfig(raw([title, { name: 'n', type: 'integer', translated: true }]))).toThrow();
  });
});

describe('translated values', () => {
  let config: Config;
  let previous: Config;
  beforeEach(() => {
    previous = appConfig;
    config = loadConfig(raw([title, { name: 'body', type: 'markdown', translated: true }]));
    setAppConfig(config);
  });
  afterEach(() => setAppConfig(previous));
  const work = () => config.objects[0]!;

  it('stores a map of locale to text, requiring only the default locale', () => {
    const schema = compileCreateSchema(work());
    const id = '11111111-1111-4111-8111-111111111111';
    expect(schema.safeParse({ id, title: { en: 'Mask', hu: 'Maszk' } }).success).toBe(true);
    expect(schema.safeParse({ id, title: { en: 'Mask' }, body: { hu: 'csak magyar' } }).success).toBe(true);
    expect(schema.safeParse({ id, title: { hu: 'Maszk' } }).success).toBe(false);
    expect(schema.safeParse({ id, title: { en: 'Mask', de: 'Maske' } }).success).toBe(false);
    expect(schema.safeParse({ id, title: 'Mask' }).success).toBe(false);
  });

  it('round trips through form inputs, leaving out empty locales', () => {
    const inputs = translatedInputs('title', { en: 'Mask' });
    expect(inputs).toEqual({ 'title@en': 'Mask', 'title@hu': '' });
    expect(assembleTranslated('title', { ...inputs, 'title@hu': ' Maszk ' })).toEqual({ en: 'Mask', hu: 'Maszk' });
    expect(assembleValues(work(), 'default', inputs, 'create')).toEqual({ title: { en: 'Mask' } });
  });

  it('displays the requested locale, falling back to the default', () => {
    const value = { en: 'Mask', hu: 'Maszk' };
    expect(displayText(value, 'hu')).toBe('Maszk');
    expect(displayText({ en: 'Mask' }, 'hu')).toBe('Mask');
    expect(displayText('plain')).toBe('plain');
    expect(formatCell(work().properties[1]!, value)).toBe('Mask');
  });

  it('searches every locale', () => {
    const rows = [{ id: '1', title: { en: 'Mask', hu: 'Maszk' } }];
    expect(filterByConfig(rows, 'maszk', { fields: ['title'] })).toHaveLength(1);
  });

  it('projects an unsaved singleton translated field as an empty map', () => {
    const singleton = { ...work(), singleton: true, lifecycle: undefined, properties: [{ name: 'body', type: 'markdown' as const, translated: true }] };
    expect(synthesizeSingleton(singleton)).toMatchObject({ body: {} });
  });
});

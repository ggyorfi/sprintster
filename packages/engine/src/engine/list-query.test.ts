import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/loader.js';
import { setAppConfig } from '../config/app-config.js';
import { InMemoryEventStore } from '../events/store.js';
import { createObjectApi, type ObjectApi } from './object-api.js';
import { decodeCursor, encodeCursor } from './list-query.js';
import { isApiError } from '../errors/api-error.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const logo = { hash: 'a'.repeat(64), size: 1, contentType: 'image/png', filename: 'logo.png' };
const actions = [{ hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' }];

const raw = {
  version: '1',
  locales: ['hu', 'en'],
  objects: [
    {
      name: 'section',
      title: 'Section',
      titlePlural: 'Sections',
      route: 'sections',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'title', type: 'text', translated: true },
        { name: 'logo', type: 'image', nullable: true },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Sections', columns: [{ property: 'title' }], actions }],
      views: [{ name: 'default', title: 'Section', fields: [{ property: 'title' }] }],
    },
    {
      name: 'article',
      title: 'Article',
      titlePlural: 'Articles',
      route: 'articles',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'title', type: 'text', translated: true },
        { name: 'section', type: 'ref', target: 'section', nullable: true },
        { name: 'rank', type: 'integer', nullable: true },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [
        {
          name: 'default',
          title: 'Articles',
          columns: [{ property: 'title' }, { property: 'section.title' }],
          search: { fields: ['title'] },
          sort: '-rank',
          actions,
        },
      ],
      views: [{ name: 'default', title: 'Article', fields: [{ property: 'title' }] }],
    },
    {
      name: 'settings',
      title: 'Settings',
      titlePlural: 'Settings',
      route: 'settings',
      singleton: true,
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'name', type: 'text', default: 'Site' },
      ],
      lists: [],
      views: [{ name: 'default', title: 'Settings', fields: [{ property: 'name' }] }],
    },
  ],
};

type Row = Record<string, unknown> & { id: string };
let store: InMemoryEventStore;
let apis: Record<string, ObjectApi<Row>>;

beforeEach(async () => {
  const config = loadConfig(raw);
  setAppConfig(config);
  store = new InMemoryEventStore();
  apis = {};
  for (const o of config.objects) apis[o.name] = createObjectApi<Row>(store, o, { resolveTarget: (name) => apis[name] });
  await apis['section']!.add({ id: id(1), title: { hu: 'Hírek', en: 'News' }, logo });
  await apis['section']!.add({ id: id(2), title: { hu: 'Angol', en: 'English' }, logo: null });
  const articles: Array<[number, Record<string, string>, number, number | null]> = [
    [11, { hu: 'Óra', en: 'Clock' }, 3, 1],
    [12, { hu: 'Alma', en: 'Apple' }, 1, 2],
    [13, { hu: 'Zebra', en: 'Zebra' }, 2, null],
    [14, { hu: 'Törölt óra', en: 'Gone' }, 9, 1],
  ];
  for (const [n, title, rank, section] of articles) await apis['article']!.add({ id: id(n), title, rank, section: section === null ? null : id(section) });
  await apis['article']!.remove!(id(14));
});

const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => r['id']);
const article = () => apis['article']!;

describe('ObjectApi.query (ADR 24)', () => {
  it('uses the list sort, hides removed records and counts what matches', async () => {
    const page = await article().query({});
    expect(ids(page.rows)).toEqual([id(11), id(13), id(12)]);
    expect(page.total).toBe(3);
  });

  it('lists newest first when the list sets no sort, and sorts by createdAt or updatedAt on request', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      await apis['section']!.add({ id: id(3), title: { hu: 'Régi', en: 'Old' }, logo: null });
      vi.setSystemTime(new Date('2030-01-02T00:00:00Z'));
      await apis['section']!.add({ id: id(4), title: { hu: 'Új', en: 'New' }, logo: null });
      vi.setSystemTime(new Date('2030-01-03T00:00:00Z'));
      await apis['section']!.update!(id(3), { title: { hu: 'Régi', en: 'Old again' } });
    } finally {
      vi.useRealTimers();
    }
    const section = apis['section']!;
    expect(ids((await section.query({})).rows).slice(0, 2)).toEqual([id(4), id(3)]);
    expect(ids((await section.query({ sort: 'createdAt' })).rows).slice(-2)).toEqual([id(3), id(4)]);
    expect(ids((await section.query({ sort: '-updatedAt' })).rows).slice(0, 2)).toEqual([id(3), id(4)]);
  });

  it('searches every language of a translated field, ignoring case and accents', async () => {
    expect(ids((await article().query({ q: 'ORA' })).rows)).toEqual([id(11)]);
    expect(ids((await article().query({ q: 'clock' })).rows)).toEqual([id(11)]);
  });

  it('sorts a translated field by the default language, and by a referenced record\'s field', async () => {
    expect(ids((await article().query({ sort: 'title' })).rows)).toEqual([id(12), id(13), id(11)]);
    expect(ids((await article().query({ sort: 'section.title' })).rows)).toEqual([id(12), id(11), id(13)]);
  });

  it('returns only the asked fields, with the referenced value and image filled in', async () => {
    const [row] = (await article().query({ fields: ['title', 'section.title', 'section#thumb'], sort: 'rank' })).rows.slice(-1);
    expect(row).toEqual({ id: id(11), title: { hu: 'Óra', en: 'Clock' }, section: id(1), 'section.title': { hu: 'Hírek', en: 'News' }, 'section#thumb': logo });
  });

  it('walks every record by cursor, the token opaque to the caller', async () => {
    const first = await article().query({ limit: 2 });
    expect(ids(first.rows)).toEqual([id(11), id(13)]);
    const second = await article().query({ limit: 2, after: first.next! });
    expect(ids(second.rows)).toEqual([id(12)]);
    expect(second.next).toBeNull();
    expect(second.total).toBeUndefined();
    expect(decodeCursor(encodeCursor({ key: 'Ő é', id: 'x' })!)).toEqual({ key: 'Ő é', id: 'x' });
  });

  it('refuses a page over 100 rows, offset with a cursor, a bad cursor, and an unknown sort or field', async () => {
    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return false;
      } catch (err) {
        return isApiError(err) && err.statusCode === 400;
      }
    };
    expect(await refused(() => article().query({ limit: 101 }))).toBe(true);
    expect(await refused(() => article().query({ offset: 1, after: 'x' }))).toBe(true);
    expect(await refused(() => article().query({ after: 'not-a-cursor' }))).toBe(true);
    expect(await refused(() => article().query({ sort: 'nope' }))).toBe(true);
    expect(await refused(() => article().query({ sort: 'rank.title' }))).toBe(true);
    expect(await refused(() => article().query({ fields: ['nope'] }))).toBe(true);
    expect(await refused(() => article().query({ list: 'other' }))).toBe(true);
  });

  it('answers a singleton as its one record', async () => {
    expect((await apis['settings']!.query({})).rows).toEqual([expect.objectContaining({ name: 'Site' })]);
  });

  it('finds a record by its new search text after an edit', async () => {
    await article().update(id(12), { title: { hu: 'Körte', en: 'Pear' } });
    expect(ids((await article().query({ q: 'korte' })).rows)).toEqual([id(12)]);
    expect((await article().query({ q: 'alma' })).rows).toEqual([]);
  });
});

describe('pins through the object API (ADR 26)', () => {
  it('pins the record as of a position, and unpins one that did not exist yet', async () => {
    const before = await store.position();
    await article().update(id(11), { title: { hu: 'Óra, javítva', en: 'Clock, fixed' } });
    await article().pin('published', id(11), before);
    await article().pin('published', id(12), 1);
    const page = await article().queryPinned('published', { fields: ['title'] });
    expect(page.rows).toEqual([{ id: id(11), title: { hu: 'Óra', en: 'Clock' } }]);
    await article().unpin('published', id(11));
    expect((await article().queryPinned('published', {})).rows).toEqual([]);
  });

  it('redacts the pinned version with the record', async () => {
    await article().pin('published', id(13), await store.position());
    await article().redact(id(13), ['title']);
    expect((await article().queryPinned('published', { fields: ['title'] })).rows).toEqual([{ id: id(13), title: null }]);
    const feed = await store.states.pins.since('published', 0, 0, 10);
    expect(feed.pins.at(-1)).toMatchObject({ streamId: id(13), removed: false });
  });
});

describe('list sort in the config', () => {
  it('is checked by loadConfig', () => {
    const withSort = (sort: string) => ({ ...raw, objects: raw.objects.map((o) => (o.name === 'article' ? { ...o, lists: [{ ...o.lists[0]!, sort }] } : o)) });
    expect(() => loadConfig(withSort('section.title'))).not.toThrow();
    expect(() => loadConfig(withSort('nope'))).toThrow(/list 'article.default' sort/);
    expect(() => loadConfig(withSort('section.nope'))).toThrow(/sort/);
  });
});

describe('ids', () => {
  it('reads only the records asked for, and at most a page of them', async () => {
    expect(ids((await article().query({ ids: [id(12), id(99)] })).rows)).toEqual([id(12)]);
    await expect(article().query({ ids: Array.from({ length: 101 }, (_, i) => id(i)) })).rejects.toThrow(/at most 100/);
  });
});

describe('pinning a deleted record', () => {
  it('takes it out of the set', async () => {
    await article().pin('published', id(12), await store.position());
    await article().remove!(id(12));
    await article().pin('published', id(12), await store.position());
    expect((await article().queryPinned('published', {})).rows).toEqual([]);
    expect((await store.states.pins.since('published', 0, 0, 10)).pins.at(-1)).toMatchObject({ streamId: id(12), removed: true });
  });
});

describe('list filters (ADR 27)', () => {
  const withFilters = (filters: unknown) => ({
    ...raw,
    objects: raw.objects.map((o) => (o.name === 'section' ? { ...o, lists: [{ ...o.lists[0]!, filters }] } : o)),
  });
  const logoFilter = [{ label: 'Logo', options: [{ label: 'With', property: 'logo.contentType', startsWith: 'image/' }, { label: 'Without', property: 'logo.contentType', notStartsWith: 'image/' }] }];

  it('narrows a list by a named option of its filters', async () => {
    const config = loadConfig(withFilters(logoFilter));
    setAppConfig(config);
    const sections = createObjectApi<Row>(store, config.objects[0]!);
    expect(ids((await sections.query({ filter: ['Logo:With'] })).rows)).toEqual([id(1)]);
    expect(ids((await sections.query({ filter: ['Logo:Without'] })).rows)).toEqual([id(2)]);
  });

  it('refuses an unknown option and the same group twice', async () => {
    const config = loadConfig(withFilters(logoFilter));
    setAppConfig(config);
    const sections = createObjectApi<Row>(store, config.objects[0]!);
    await expect(sections.query({ filter: ['Logo:Maybe'] })).rejects.toThrow(/no filter/);
    await expect(sections.query({ filter: ['Logo:With', 'Logo:Without'] })).rejects.toThrow(/twice/);
  });

  it('is checked by loadConfig: a readable path, one test, unique labels', () => {
    const option = (o: Record<string, unknown>) => withFilters([{ label: 'F', options: [{ label: 'A', ...o }] }]);
    expect(() => loadConfig(option({ property: 'logo.size', equals: 1 }))).not.toThrow();
    expect(() => loadConfig(option({ property: 'nope', equals: 1 }))).toThrow(/not a property/);
    expect(() => loadConfig(option({ property: 'title.hu', equals: 'x' }))).toThrow(/not a field/);
    expect(() => loadConfig(option({ property: 'title' }))).toThrow(/exactly one/);
    expect(() => loadConfig(option({ property: 'title', equals: 'a', startsWith: 'b' }))).toThrow(/exactly one/);
    expect(() => loadConfig(withFilters([...logoFilter, ...logoFilter]))).toThrow(/duplicate filter/);
  });
});

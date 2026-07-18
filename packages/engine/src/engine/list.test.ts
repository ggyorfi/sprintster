import { describe, it, expect } from 'vitest';
import { formatCell, listColumns, filterByConfig } from './list.js';
import { fixtureClientConfig, fixtureRefConfig, fixtureMemoObject } from '../config/fixture.js';
import type { PropertyConfig } from '../config/schema.js';

const ID = '11111111-1111-4111-8111-111111111111';

const money: PropertyConfig = { name: 'rate', type: 'money', currency: 'GBP' };
const integer: PropertyConfig = { name: 'paymentTermsDays', type: 'integer' };
const id: PropertyConfig = { name: 'id', type: 'id', strategy: 'uuid' };
const enumProp: PropertyConfig = { name: 'service', type: 'enum', values: ['student', 'other'] };
const objectProp: PropertyConfig = { name: 'address', type: 'object', properties: [] };
const datetime: PropertyConfig = { name: 'publishedAt', type: 'datetime' };
const refs: PropertyConfig = { name: 'tags', type: 'refs', target: 'tag' };

describe('formatCell', () => {
  it('formats money pence as pounds', () => {
    expect(formatCell(money, '5000')).toBe('£50.00');
  });

  it('appends a column suffix to an integer', () => {
    expect(formatCell(integer, 7, 'd')).toBe('7d');
    expect(formatCell(integer, 7)).toBe('7');
  });

  it('renders the short form of a uuid id', () => {
    expect(formatCell(id, ID)).toBe('11111111');
  });

  it('passes enums and text through, omits objects, and blanks null', () => {
    expect(formatCell(enumProp, 'student')).toBe('student');
    expect(formatCell(objectProp, { line1: 'x' })).toBe('');
    expect(formatCell(money, null)).toBe('');
  });

  it('formats a datetime as a compact UTC minute string, sortable lexically', () => {
    expect(formatCell(datetime, '2026-07-18T14:30:00Z')).toBe('2026-07-18 14:30');
    expect(formatCell(datetime, '2026-07-18T16:30:00+02:00')).toBe('2026-07-18 14:30');
  });

  it('joins a multi-ref value into a comma-separated list of ids', () => {
    expect(formatCell(refs, ['a', 'b', 'c'])).toBe('a, b, c');
    expect(formatCell(refs, [])).toBe('');
  });
});

describe('listColumns', () => {
  it('resolves the client default list columns to typed specs', () => {
    const cols = listColumns(fixtureClientConfig);
    expect(cols.map((c) => [c.property.name, c.label, c.width, c.suffix])).toEqual([
      ['id', 'ID', 10, ''],
      ['name', 'Name', 30, ''],
      ['service', 'Service', 15, ''],
      ['rate', 'Rate', 12, ''],
      ['paymentTermsDays', 'Terms', 10, 'd'],
    ]);
    expect(cols[0]?.property.type).toBe('id');
    expect(cols[3]?.property.type).toBe('money');
  });

  it('keeps key equal to the property name for a plain column', () => {
    const cols = listColumns(fixtureClientConfig);
    expect(cols.map((c) => c.key)).toEqual(['id', 'name', 'service', 'rate', 'paymentTermsDays']);
  });

  it('resolves a dotted ref-traversal column to the target leaf property', () => {
    const resolve = (name: string) => fixtureRefConfig.objects.find((o) => o.name === name);
    const cols = listColumns(fixtureMemoObject, 'default', resolve);
    const clientCol = cols.find((c) => c.key === 'client.name');
    expect(clientCol?.label).toBe('Client');
    expect(clientCol?.property.type).toBe('text');
    expect(clientCol?.property.name).toBe('name');
  });

  it('degrades a dotted column to plain text when no resolver is supplied', () => {
    const cols = listColumns(fixtureMemoObject, 'default');
    const clientCol = cols.find((c) => c.key === 'client.name');
    expect(clientCol?.property.type).toBe('text');
    expect(clientCol?.property.name).toBe('client.name');
  });
});

describe('filterByConfig', () => {
  const rows = [
    { id: 'aaaa1111-0000-4000-8000-000000000000', name: 'Thomas Lam', service: 'student' },
    { id: 'bbbb2222-0000-4000-8000-000000000000', name: 'Alfie Granger', service: 'accompaniment' },
  ];
  const spec = { fields: ['name', 'service'], idPrefix: true };

  it('returns all rows for an empty query', () => {
    expect(filterByConfig(rows, '   ', spec)).toEqual(rows);
  });

  it('matches case-insensitively across configured fields (multi-term AND)', () => {
    expect(filterByConfig(rows, 'lam', spec).map((r) => r.name)).toEqual(['Thomas Lam']);
    expect(filterByConfig(rows, 'alfie accompaniment', spec).map((r) => r.name)).toEqual(['Alfie Granger']);
    expect(filterByConfig(rows, 'lam accompaniment', spec)).toEqual([]);
  });

  it('matches on an id prefix when idPrefix is set', () => {
    expect(filterByConfig(rows, 'bbbb', spec).map((r) => r.name)).toEqual(['Alfie Granger']);
  });

  it('does not match the id when idPrefix is off', () => {
    expect(filterByConfig(rows, 'bbbb', { fields: ['name'] })).toEqual([]);
  });
});

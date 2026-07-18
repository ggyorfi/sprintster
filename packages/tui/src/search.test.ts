import { describe, it, expect } from 'vitest';
import { fixtureClientConfig } from '@sprintster/engine';
import { makeFilter } from './search.js';

type Row = {
  id: string;
  name: string;
  service: string;
  rate: string;
  paymentTermsDays: number;
  address: unknown;
  notes: string | null;
  removed: boolean;
};

const filterClients = makeFilter<Row>(fixtureClientConfig);

function client(over: Partial<Row>): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alfie Granger',
    service: 'student',
    rate: '5000',
    paymentTermsDays: 7,
    address: null,
    notes: null,
    removed: false,
    ...over,
  };
}

const lam = client({
  id: 'a1b2c3d4-0000-4000-8000-000000000000',
  name: 'Thomas Lam',
  service: 'student',
  notes: 'Tuesdays, remote',
});
const granger = client({
  id: 'f0e1d2c3-0000-4000-8000-000000000000',
  name: 'Alfie Granger-Howell',
  service: 'accompaniment',
});
const synagogue = client({
  id: 'beef0000-0000-4000-8000-000000000000',
  name: 'Belsize Square Synagogue',
  service: 'other',
  address: { line1: '51 Belsize Square', line2: null, city: 'London', postcode: 'NW3 4HX' },
});
const all = [lam, granger, synagogue];

describe('makeFilter (client search fields)', () => {
  it('returns everything for an empty or whitespace query', () => {
    expect(filterClients(all, '')).toEqual(all);
    expect(filterClients(all, '   ')).toEqual(all);
  });

  it('matches name case-insensitively (substring)', () => {
    expect(filterClients(all, 'lam').map((c) => c.name)).toEqual(['Thomas Lam']);
    expect(filterClients(all, 'GRANGER').map((c) => c.name)).toEqual(['Alfie Granger-Howell']);
  });

  it('matches service', () => {
    expect(filterClients(all, 'accompaniment').map((c) => c.name)).toEqual(['Alfie Granger-Howell']);
    expect(filterClients(all, 'student').map((c) => c.name)).toEqual(['Thomas Lam']);
    expect(filterClients(all, 'other').map((c) => c.name)).toEqual(['Belsize Square Synagogue']);
  });

  it('matches the id by prefix (the dimmed short id)', () => {
    expect(filterClients(all, 'a1b2').map((c) => c.name)).toEqual(['Thomas Lam']);
    expect(filterClients(all, 'a1b2c3d4').map((c) => c.name)).toEqual(['Thomas Lam']);
    expect(filterClients(all, 'b2c3')).toEqual([]);
  });

  it('does NOT match notes or address fields', () => {
    expect(filterClients(all, 'remote')).toEqual([]);
    expect(filterClients(all, 'nw3')).toEqual([]);
  });

  it('ANDs multiple terms across name + service + id', () => {
    expect(filterClients(all, 'thomas student').map((c) => c.name)).toEqual(['Thomas Lam']);
    expect(filterClients(all, 'lam accompaniment')).toEqual([]);
    expect(filterClients(all, 'a1b2 student').map((c) => c.name)).toEqual(['Thomas Lam']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterClients(all, 'zzzzz')).toEqual([]);
  });
});

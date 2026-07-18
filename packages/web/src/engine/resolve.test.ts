import { describe, it, expect, vi } from 'vitest';
import { appConfig, setAppConfig, viewFields, fixtureRefConfig, type ApiClient, type ViewFieldSpec } from '@sprintster/engine';
import {
  makeResolveObject,
  statusTone,
  formatError,
  readPath,
  enrichRefColumns,
  initInputs,
  type Row,
} from './resolve.js';

setAppConfig(fixtureRefConfig);
const resolveObject = makeResolveObject();
const memo = appConfig.objects.find((o) => o.name === 'memo')!;
const client = appConfig.objects.find((o) => o.name === 'client')!;

describe('makeResolveObject', () => {
  it('resolves a configured object by name', () => {
    expect(resolveObject('client')?.name).toBe('client');
    expect(resolveObject('nope')).toBeUndefined();
  });
});

describe('statusTone', () => {
  it('maps lifecycle values to pill tones with a neutral default', () => {
    expect(statusTone('paid')).toBe('success');
    expect(statusTone('cancelled')).toBe('muted');
    expect(statusTone('live')).toBe('info');
    expect(statusTone('whatever')).toBe('neutral');
  });
});

describe('formatError', () => {
  it('formats plain errors', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });
});

describe('readPath', () => {
  it('walks dotted paths and degrades to undefined', () => {
    const row: Row = { name: 'A', address: { city: 'Oxford' } };
    expect(readPath(row, 'name')).toBe('A');
    expect(readPath(row, 'address.city')).toBe('Oxford');
    expect(readPath(row, 'address.zip')).toBeUndefined();
    expect(readPath(row, 'missing.deep')).toBeUndefined();
  });
});

describe('enrichRefColumns', () => {
  it('joins ref targets onto dotted-path columns (client.name on invoices)', async () => {
    const clients: Row[] = [{ id: 'c1', name: 'Oakwood Strings' }];
    const invoices: Row[] = [{ id: 'i1', client: 'c1', total: '12000' }];
    const api = {
      object: <T,>(name: string) => ({
        list: async () => (name === 'client' ? clients : invoices) as T[],
      }),
    } as unknown as ApiClient;

    const enriched = await enrichRefColumns(api, memo, resolveObject, invoices);
    expect(enriched[0]!['client.name']).toBe('Oakwood Strings');
  });

  it('returns rows unchanged when there are no dotted columns', async () => {
    const rows: Row[] = [{ id: 'c1', name: 'A' }];
    const api = { object: vi.fn() } as unknown as ApiClient;
    expect(await enrichRefColumns(api, client, resolveObject, rows)).toEqual(rows);
  });
});

describe('initInputs', () => {
  it('seeds create-mode inputs from property defaults', () => {
    const specs = viewFields(client, 'default', 'create', resolveObject);
    const inputs = initInputs(specs, 'create', null);
    expect(inputs['service']).toBe('student');
    expect(inputs['paymentTermsDays']).toBe('7');
  });

  it('seeds edit-mode inputs from the row, converting money pence to pounds', () => {
    const specs = viewFields(client, 'default', 'edit', resolveObject);
    const inputs = initInputs(specs, 'edit', { id: 'c1', name: 'A', rate: '5000' });
    expect(inputs['name']).toBe('A');
    expect(inputs['rate']).toBe('50');
  });

  it('seeds array fields into indexed flat keys', () => {
    const spec = {
      path: 'emails',
      property: {
        name: 'emails',
        type: 'array',
        item: { properties: [{ name: 'value', type: 'text' }, { name: 'label', type: 'text', nullable: true }] },
      },
      label: 'Emails',
      placeholder: '',
      rows: 1,
      group: null,
      editable: true,
      derivedFromRef: null,
      defaultInput: '',
    } as unknown as ViewFieldSpec;
    const inputs = initInputs([spec], 'edit', { emails: [{ value: 'a@b.com', label: 'work' }] });
    expect(inputs['emails.0.value']).toBe('a@b.com');
    expect(inputs['emails.0.label']).toBe('work');
  });
});

import { describe, it, expect } from 'vitest';
import { makeReducer } from './reducer.js';
import { fixtureClientConfig, fixtureStatusObject } from '../config/fixture.js';
import type { EventRow } from '../events/store.js';

const ID_A = '11111111-1111-4111-8111-111111111111';

function eventRow(
  streamType: string,
  eventType: string,
  payload: Record<string, unknown>,
  streamVersion = 1,
  streamId?: string,
): EventRow {
  return {
    id: String(streamVersion),
    partitionId: 0,
    streamType,
    streamId: streamId ?? (payload[`${streamType}_id`] as string),
    streamVersion,
    eventType,
    eventVersion: 1,
    payload,
    occurredAt: '2026-05-22T10:00:00.000Z',
    recordedAt: '2026-05-22T10:00:00.000Z',
    actor: 'mihaly',
    correlationId: null,
  };
}

describe('makeReducer over the client config (softDelete)', () => {
  const fold = makeReducer<Record<string, unknown> & { id: string }>(fixtureClientConfig);
  const added = (p: Record<string, unknown>) => eventRow('client', 'ClientAdded', p);

  it('folds ClientAdded from config-named fields, dropping client_id, initialising removed=false', () => {
    const state = fold(null, added({
      client_id: ID_A,
      name: 'Alfie Granger-Howell',
      service: 'student',
      rate: '5000',
      paymentTermsDays: 7,
      address: null,
      notes: null,
    }));
    expect(state).toEqual({
      id: ID_A,
      name: 'Alfie Granger-Howell',
      service: 'student',
      rate: '5000',
      paymentTermsDays: 7,
      address: null,
      notes: null,
      removed: false,
    });
  });

  it('takes id from the envelope, not the payload', () => {
    const state = fold(null, eventRow('client', 'ClientAdded', { client_id: 'ignored', name: 'X' }, 1, 'STREAM-9'));
    expect(state?.id).toBe('STREAM-9');
  });

  it('applies ClientFieldChanged and ClientRemoved', () => {
    const base = fold(null, added({ client_id: ID_A, name: 'Alfie', rate: '5000' }));
    const renamed = fold(base, eventRow('client', 'ClientFieldChanged', { client_id: ID_A, field: 'name', value: 'Alfie G-H' }, 2));
    expect(renamed?.['name']).toBe('Alfie G-H');
    expect(renamed?.['rate']).toBe('5000');
    const removed = fold(renamed, eventRow('client', 'ClientRemoved', { client_id: ID_A }, 3));
    expect(removed?.['removed']).toBe(true);
  });

  it('ignores a field change on null state and unknown event types', () => {
    expect(fold(null, eventRow('client', 'ClientFieldChanged', { client_id: ID_A, field: 'name', value: 'x' }, 2))).toBeNull();
    const base = fold(null, added({ client_id: ID_A, name: 'X' }));
    expect(fold(base, eventRow('client', 'SomeFutureEvent', { client_id: ID_A }, 2))).toEqual(base);
  });
});

describe('makeReducer over a statusField object', () => {
  const fold = makeReducer<Record<string, unknown> & { id: string }>(fixtureStatusObject);

  it('initialises the status enum to its config default on Added', () => {
    const state = fold(null, eventRow('widget', 'WidgetAdded', { widget_id: ID_A, label: 'A' }));
    expect(state).toEqual({ id: ID_A, label: 'A', status: 'live' });
  });

  it('transitions status via WidgetFieldChanged', () => {
    const base = fold(null, eventRow('widget', 'WidgetAdded', { widget_id: ID_A, label: 'A' }));
    const out = fold(base, eventRow('widget', 'WidgetFieldChanged', { widget_id: ID_A, field: 'status', value: 'paid' }, 2));
    expect(out?.['status']).toBe('paid');
  });

  it('folds a transition event onto the statusField (WidgetCancelled -> cancelled)', () => {
    const base = fold(null, eventRow('widget', 'WidgetAdded', { widget_id: ID_A, label: 'A' }));
    const out = fold(base, eventRow('widget', 'WidgetCancelled', { widget_id: ID_A }, 2));
    expect(out?.['status']).toBe('cancelled');
  });

  it('folds a different transition event with a distinct to-state (WidgetPaid -> paid)', () => {
    const base = fold(null, eventRow('widget', 'WidgetAdded', { widget_id: ID_A, label: 'A' }));
    const out = fold(base, eventRow('widget', 'WidgetPaid', { widget_id: ID_A }, 2));
    expect(out?.['status']).toBe('paid');
  });
});

import { describe, it, expect } from 'vitest';
import {
  eventKey,
  getEventSchema,
  isKnownEvent,
  allEventKeys,
} from './registry.js';
import { fixtureConfig } from '../config/fixture.js';
import { setAppConfig } from '../config/app-config.js';

setAppConfig(fixtureConfig);

describe('eventKey', () => {
  it('joins type and version with @', () => {
    expect(eventKey('ClientAdded', 1)).toBe('ClientAdded@1');
  });
});

describe('getEventSchema', () => {
  it('returns a Zod schema for a registered (type, version)', () => {
    const schema = getEventSchema('ClientAdded', 1);
    expect(schema).toBeDefined();
    expect(typeof schema?.parse).toBe('function');
  });

  it('returns undefined for an unknown type', () => {
    expect(getEventSchema('NotAnEvent', 1)).toBeUndefined();
  });

  it('returns undefined for an unknown version of a known type', () => {
    expect(getEventSchema('ClientAdded', 99)).toBeUndefined();
  });
});

describe('isKnownEvent', () => {
  it('returns true for registered events', () => {
    expect(isKnownEvent('ClientAdded', 1)).toBe(true);
  });

  it('returns false for unknown events', () => {
    expect(isKnownEvent('Unknown', 1)).toBe(false);
    expect(isKnownEvent('ClientAdded', 99)).toBe(false);
  });
});

describe('allEventKeys', () => {
  it('returns the three generated client event keys', () => {
    const keys = allEventKeys();
    expect(keys).toContain('ClientAdded@1');
    expect(keys).toContain('ClientFieldChanged@1');
    expect(keys).toContain('ClientRemoved@1');
  });
});

describe('generated generic payload schemas', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111';

  it('ClientAdded requires client_id and keeps arbitrary config fields (passthrough)', () => {
    const schema = getEventSchema('ClientAdded', 1)!;
    const payload = { client_id: ID_A, name: 'X', rate: '5000', bajdi: 'kept' };
    expect(schema.parse(payload)).toEqual(payload);
    expect(() => schema.parse({ name: 'no id' })).toThrow();
  });

  it('ClientFieldChanged carries field + value', () => {
    const schema = getEventSchema('ClientFieldChanged', 1)!;
    const payload = { client_id: ID_A, field: 'rate', value: '6000' };
    expect(schema.parse(payload)).toEqual(payload);
    expect(() => schema.parse({ client_id: ID_A, field: '', value: 1 })).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { compileProperty, compileObject, compileCreateSchema, compileUpdateSchema } from './compile.js';
import type { ObjectConfig, PropertyConfig } from './schema.js';

const ID_A = '11111111-1111-4111-8111-111111111111';

describe('compileProperty: id', () => {
  it('uuid strategy accepts a UUID, rejects anything else', () => {
    const schema = compileProperty({ name: 'id', type: 'id', strategy: 'uuid' });
    expect(schema.parse(ID_A)).toBe(ID_A);
    expect(() => schema.parse('GRA-A26')).toThrow();
  });

  it('sequence strategy accepts a non-empty string', () => {
    const schema = compileProperty({ name: 'id', type: 'id', strategy: 'sequence' });
    expect(schema.parse('42')).toBe('42');
    expect(() => schema.parse('')).toThrow();
  });
});

describe('compileProperty: text', () => {
  it('enforces minLength and maxLength', () => {
    const schema = compileProperty({
      name: 'name',
      type: 'text',
      validation: { required: true, minLength: 1, maxLength: 3 },
    });
    expect(schema.parse('ab')).toBe('ab');
    expect(() => schema.parse('')).toThrow();
    expect(() => schema.parse('abcd')).toThrow();
  });

  it('applies an email format', () => {
    const schema = compileProperty({
      name: 'email',
      type: 'text',
      validation: { required: true, format: 'email' },
    });
    expect(schema.parse('a@b.com')).toBe('a@b.com');
    expect(() => schema.parse('not-an-email')).toThrow();
  });
});

describe('compileProperty: enum', () => {
  it('accepts declared values and rejects others', () => {
    const schema = compileProperty({
      name: 'service',
      type: 'enum',
      values: ['student', 'accompaniment', 'other'],
    });
    expect(schema.parse('student')).toBe('student');
    expect(() => schema.parse('teacher')).toThrow();
  });
});

describe('compileProperty: money', () => {
  it('validates a pence string and rejects pounds / numbers', () => {
    const schema = compileProperty({
      name: 'rate',
      type: 'money',
      currency: 'GBP',
      validation: { required: true },
    });
    expect(schema.parse('5000')).toBe('5000');
    expect(() => schema.parse('50.00')).toThrow();
    expect(() => schema.parse(5000)).toThrow();
  });
});

describe('compileProperty: integer', () => {
  it('enforces int and min', () => {
    const schema = compileProperty({
      name: 'paymentTermsDays',
      type: 'integer',
      validation: { required: true, min: 1 },
    });
    expect(schema.parse(7)).toBe(7);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(1.5)).toThrow();
  });
});

describe('compileProperty: date', () => {
  it('accepts an ISO date and rejects garbage', () => {
    const schema = compileProperty({ name: 'dateIssued', type: 'date', validation: { required: true } });
    expect(schema.parse('2026-05-24')).toBe('2026-05-24');
    expect(() => schema.parse('24/05/2026')).toThrow();
  });
});

describe('compileProperty: datetime', () => {
  it('accepts an ISO instant to the second and rejects a date-only or garbage value', () => {
    const schema = compileProperty({ name: 'publishedAt', type: 'datetime', validation: { required: true } });
    expect(schema.parse('2026-07-18T14:30:00Z')).toBe('2026-07-18T14:30:00Z');
    expect(schema.parse('2026-07-18T16:30:00.500+02:00')).toBe('2026-07-18T16:30:00.500+02:00');
    expect(() => schema.parse('2026-07-18')).toThrow();
    expect(() => schema.parse('18/07/2026 14:30')).toThrow();
  });

  it('is optional when not required', () => {
    const schema = compileProperty({ name: 'publishedAt', type: 'datetime' });
    expect(schema.parse(undefined)).toBeUndefined();
  });
});

describe('compileProperty: ref and boolean', () => {
  it('ref compiles to a non-empty id string', () => {
    const schema = compileProperty({ name: 'client', type: 'ref', target: 'client', validation: { required: true } });
    expect(schema.parse(ID_A)).toBe(ID_A);
    expect(() => schema.parse('')).toThrow();
  });

  it('boolean compiles to a boolean', () => {
    const schema = compileProperty({ name: 'removed', type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse('true')).toThrow();
  });
});

describe('compileProperty: nullable / default / optionality', () => {
  it('nullable accepts null', () => {
    const schema = compileProperty({ name: 'notes', type: 'text', nullable: true });
    expect(schema.parse(null)).toBeNull();
  });

  it('a property with a default fills it when the value is undefined', () => {
    const schema = compileProperty({
      name: 'service',
      type: 'enum',
      values: ['student', 'other'],
      default: 'student',
    });
    expect(schema.parse(undefined)).toBe('student');
  });

  it('a non-required property without a default is optional', () => {
    const schema = compileProperty({ name: 'notes', type: 'text' });
    expect(schema.parse(undefined)).toBeUndefined();
  });
});

describe('compileObject', () => {
  const clientProps: PropertyConfig[] = [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'service', type: 'enum', values: ['student', 'accompaniment', 'other'], default: 'student' },
    { name: 'rate', type: 'money', currency: 'GBP', validation: { required: true } },
    { name: 'paymentTermsDays', type: 'integer', validation: { required: true, min: 1 }, default: 7 },
    {
      name: 'address',
      type: 'object',
      nullable: true,
      properties: [
        { name: 'line1', type: 'text', nullable: true },
        { name: 'postcode', type: 'text', nullable: true },
      ],
    },
    { name: 'notes', type: 'text', validation: { maxLength: 2000 }, nullable: true },
    { name: 'removed', type: 'boolean' },
  ];

  it('validates a complete client record', () => {
    const schema = compileObject({ properties: clientProps });
    const record = {
      id: ID_A,
      name: 'Alfie Granger-Howell',
      service: 'student',
      rate: '5000',
      paymentTermsDays: 7,
      address: { line1: '51 Belsize Square', postcode: 'NW3 4HX' },
      notes: null,
      removed: false,
    };
    expect(schema.parse(record)).toMatchObject(record);
  });

  it('fills defaults for omitted fields', () => {
    const schema = compileObject({ properties: clientProps });
    const parsed = schema.parse({ id: ID_A, name: 'X', rate: '5000', removed: false });
    expect(parsed.service).toBe('student');
    expect(parsed.paymentTermsDays).toBe(7);
  });

  it('rejects a record missing a required field', () => {
    const schema = compileObject({ properties: clientProps });
    expect(() => schema.parse({ id: ID_A, rate: '5000', removed: false })).toThrow();
  });

  it('accepts a null nullable object field', () => {
    const schema = compileObject({ properties: clientProps });
    const parsed = schema.parse({ id: ID_A, name: 'X', rate: '5000', address: null, removed: false });
    expect(parsed.address).toBeNull();
  });
});

const clientLike: Pick<ObjectConfig, 'properties' | 'lifecycle'> = {
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', type: 'text', validation: { required: true, minLength: 1 } },
    { name: 'service', type: 'enum', values: ['student', 'other'], default: 'student' },
    { name: 'rate', type: 'money', currency: 'GBP', validation: { required: true } },
    { name: 'removed', type: 'boolean', system: true },
  ],
};

const invoiceLike: Pick<ObjectConfig, 'properties' | 'lifecycle'> = {
  lifecycle: { statusField: 'status' },
  properties: [
    { name: 'id', type: 'id', strategy: 'sequence', system: true },
    { name: 'client', type: 'ref', target: 'client', validation: { required: true }, editable: 'onCreate' },
    { name: 'total', type: 'money', currency: 'GBP', editable: 'always' },
    { name: 'status', type: 'enum', values: ['live', 'paid'], default: 'live' },
    { name: 'locked', type: 'boolean', editable: 'never' },
  ],
};

describe('compileCreateSchema', () => {
  it('requires a client-minted uuid id and the required fields', () => {
    const schema = compileCreateSchema(clientLike);
    expect(() => schema.parse({ name: 'X', rate: '5000' })).toThrow(); // missing id
    const parsed = schema.parse({ id: ID_A, name: 'X', rate: '5000' });
    expect(parsed.id).toBe(ID_A);
  });

  it('fills config defaults for omitted fields', () => {
    const parsed = compileCreateSchema(clientLike).parse({ id: ID_A, name: 'X', rate: '5000' });
    expect(parsed.service).toBe('student');
  });

  it('excludes the lifecycle flag from the create input', () => {
    const schema = compileCreateSchema(clientLike);
    expect(() => schema.parse({ id: ID_A, name: 'X', rate: '5000', removed: false })).toThrow();
  });

  it('excludes a daemon-allocated sequence id but keeps onCreate fields', () => {
    const schema = compileCreateSchema(invoiceLike);
    expect(schema.parse({ client: ID_A, total: '1000' })).toMatchObject({ client: ID_A });
    expect(() => schema.parse({ id: '5', client: ID_A })).toThrow(); // sequence id not authored
  });

  it('excludes never-editable (derived) fields', () => {
    const schema = compileCreateSchema(invoiceLike);
    expect(() => schema.parse({ client: ID_A, locked: true })).toThrow();
  });
});

describe('compileUpdateSchema', () => {
  it('makes every editable field optional (empty patch is valid)', () => {
    expect(compileUpdateSchema(clientLike).parse({})).toEqual({});
  });

  it('excludes id, system, and lifecycle fields', () => {
    const schema = compileUpdateSchema(clientLike);
    expect(() => schema.parse({ id: ID_A })).toThrow();
    expect(() => schema.parse({ removed: true })).toThrow();
  });

  it('excludes onCreate and never fields, keeps always fields', () => {
    const schema = compileUpdateSchema(invoiceLike);
    expect(schema.parse({ total: '2000' })).toEqual({ total: '2000' });
    expect(() => schema.parse({ client: ID_A })).toThrow(); // onCreate, frozen after create
    expect(() => schema.parse({ locked: true })).toThrow(); // never
  });

  it('validates field constraints and rejects unknown keys', () => {
    const schema = compileUpdateSchema(clientLike);
    expect(() => schema.parse({ rate: '50.00' })).toThrow();
    expect(() => schema.parse({ bogus: 1 })).toThrow();
  });
});

describe('compileProperty: array', () => {
  const emails: PropertyConfig = {
    name: 'emails',
    type: 'array',
    item: {
      properties: [
        { name: 'value', type: 'text' },
        { name: 'label', type: 'text', nullable: true },
      ],
    },
  };

  it('accepts an array of item objects', () => {
    const schema = compileProperty(emails);
    expect(schema.parse([{ value: 'a@x', label: 'home' }])).toEqual([{ value: 'a@x', label: 'home' }]);
  });

  it('defaults to an empty array when omitted', () => {
    const schema = compileProperty(emails);
    expect(schema.parse(undefined)).toEqual([]);
  });

  it('enforces maxItems', () => {
    const schema = compileProperty({ ...emails, validation: { maxItems: 1 } });
    expect(() => schema.parse([{ value: 'a' }, { value: 'b' }])).toThrow();
  });

  it('rejects items with the wrong shape', () => {
    const schema = compileProperty(emails);
    expect(() => schema.parse([{ value: 123 }])).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/loader.js';
import { assembleValues, hasView, viewFields, arrayInitialValues, arrayItemCount, regroupArray } from './view.js';
import type { ObjectConfig, PropertyConfig } from '../config/schema.js';

const emailsProp = {
  name: 'emails',
  type: 'array',
  item: {
    properties: [
      { name: 'value', type: 'text' },
      { name: 'label', type: 'text', nullable: true },
    ],
  },
} satisfies PropertyConfig;

const withArray: ObjectConfig = {
  name: 'person',
  title: 'Person',
  titlePlural: 'People',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    emailsProp,
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [{ name: 'default', title: 'People', columns: [{ property: 'id' }] }],
  views: [{ name: 'default', title: 'Person', fields: [{ property: 'emails' }] }],
};

describe('array value model (indexed flat paths)', () => {
  it('arrayInitialValues flattens an array into indexed keys', () => {
    expect(arrayInitialValues(emailsProp, 'emails', [{ value: 'a@x', label: 'home' }, { value: 'b@x', label: null }])).toEqual({
      'emails.0.value': 'a@x',
      'emails.0.label': 'home',
      'emails.1.value': 'b@x',
      'emails.1.label': '',
    });
  });
  it('arrayItemCount counts items from indexed keys', () => {
    expect(arrayItemCount('emails', { 'emails.0.value': 'a', 'emails.1.value': 'b', 'other': 'x' })).toBe(2);
    expect(arrayItemCount('emails', {})).toBe(0);
  });
  it('regroupArray rebuilds items and drops fully-empty ones', () => {
    const inputs = { 'emails.0.value': 'a@x', 'emails.0.label': 'home', 'emails.1.value': '', 'emails.1.label': '' };
    expect(regroupArray(emailsProp, 'emails', inputs)).toEqual([{ value: 'a@x', label: 'home' }]);
  });
  it('round-trips arrayInitialValues -> regroupArray', () => {
    const items = [{ value: 'a@x', label: 'work' }, { value: 'b@x', label: null }];
    expect(regroupArray(emailsProp, 'emails', arrayInitialValues(emailsProp, 'emails', items))).toEqual(items);
  });
});

describe('assembleValues with an array field', () => {
  it('reassembles indexed flat keys into an array of items', () => {
    const out = assembleValues(
      withArray,
      'default',
      { 'emails.0.value': 'a@x', 'emails.0.label': 'home', 'emails.1.value': 'b@x', 'emails.1.label': 'work' },
      'create',
    );
    expect(out['emails']).toEqual([
      { value: 'a@x', label: 'home' },
      { value: 'b@x', label: 'work' },
    ]);
  });
  it('yields an empty array when there are no item keys', () => {
    expect(assembleValues(withArray, 'default', {}, 'create')['emails']).toEqual([]);
  });
});

const withView: ObjectConfig = {
  name: 'thing',
  title: 'Thing',
  titlePlural: 'Things',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'label', type: 'text', title: 'Label' },
    { name: 'amount', type: 'money', currency: 'GBP', title: 'Amount' },
    {
      name: 'addr',
      type: 'object',
      title: 'Address',
      properties: [
        { name: 'line1', type: 'text', title: 'Line 1' },
        { name: 'city', type: 'text', title: 'City' },
      ],
    },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [{ name: 'default', title: 'Things', columns: [{ property: 'label' }] }],
  views: [
    {
      name: 'default',
      title: 'Thing details',
      fields: [
        { property: 'label' },
        { property: 'amount', label: 'Amount paid' },
        {
          kind: 'fieldset',
          title: 'Address',
          fields: [{ property: 'addr.line1' }, { property: 'addr.city' }],
        },
      ],
    },
  ],
};

const withoutView: ObjectConfig = { ...withView, views: undefined };

describe('hasView', () => {
  it('returns true when the object has a default view', () => {
    expect(hasView(withView)).toBe(true);
  });
  it('returns false when the object has no views', () => {
    expect(hasView(withoutView)).toBe(false);
  });
  it('returns false for a named view that does not exist', () => {
    expect(hasView(withView, 'compact')).toBe(false);
  });
});

describe('viewFields (create mode)', () => {
  it('emits each declared field once, tagging fieldset members with the fieldset title as group', () => {
    const specs = viewFields(withView, 'default', 'create');
    expect(specs.map((s) => s.path)).toEqual(['label', 'amount', 'addr.line1', 'addr.city']);
    expect(specs[0]?.label).toBe('Label');
    expect(specs[0]?.group).toBeNull();
    expect(specs[1]?.label).toBe('Amount paid');
    expect(specs[1]?.group).toBeNull();
    expect(specs[2]?.group).toBe('Address');
    expect(specs[3]?.group).toBe('Address');
  });

  it('rejects a top-level reference to an object-typed property (must use dotted path or fieldset)', () => {
    expect(() =>
      loadConfig({
        version: '1',
        objects: [
          {
            ...withView,
            views: [{ name: 'default', title: 'X', fields: [{ property: 'addr' }] }],
          },
        ],
      }),
    ).toThrow(/object property/);
  });
  it('returns an empty list when no view is configured', () => {
    expect(viewFields(withoutView, 'default', 'create')).toEqual([]);
  });
  it('skips fields whose property does not exist', () => {
    const broken: ObjectConfig = {
      ...withView,
      views: [{ name: 'default', title: 'X', fields: [{ property: 'label' }, { property: 'nope' }] }],
    };
    expect(viewFields(broken, 'default', 'create').map((s) => s.path)).toEqual(['label']);
  });
  it('marks every spec editable when the property has no editable restriction', () => {
    const specs = viewFields(withView, 'default', 'create');
    expect(specs.every((s) => s.editable)).toBe(true);
  });
});

describe('viewFields editability composition', () => {
  const obj: ObjectConfig = {
    name: 'thing',
    title: 'Thing',
    titlePlural: 'Things',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'label', type: 'text', title: 'Label' },
      { name: 'fixed', type: 'text', title: 'Fixed', editable: 'never' },
      { name: 'createOnly', type: 'text', title: 'Create Only', editable: 'onCreate' },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Things', columns: [{ property: 'label' }] }],
    views: [
      {
        name: 'default',
        title: 'Thing',
        fields: [{ property: 'label' }, { property: 'label', readOnly: true, label: 'Label (locked)' }, { property: 'fixed' }, { property: 'createOnly' }],
      },
    ],
  };

  it("'view' mode forces every field read-only", () => {
    const specs = viewFields(obj, 'default', 'view');
    expect(specs.every((s) => !s.editable)).toBe(true);
  });

  it("editable: 'never' is always read-only", () => {
    const create = viewFields(obj, 'default', 'create');
    const fixed = create.find((s) => s.path === 'fixed');
    expect(fixed?.editable).toBe(false);
  });

  it("editable: 'onCreate' is writable on create but read-only on edit", () => {
    const create = viewFields(obj, 'default', 'create');
    const edit = viewFields(obj, 'default', 'edit');
    expect(create.find((s) => s.path === 'createOnly')?.editable).toBe(true);
    expect(edit.find((s) => s.path === 'createOnly')?.editable).toBe(false);
  });

  it('field-level readOnly overrides an editable property', () => {
    const create = viewFields(obj, 'default', 'create');
    expect(create[0]?.editable).toBe(true);
    expect(create[1]?.editable).toBe(false);
  });
});

describe('viewFields dotted ref traversal', () => {
  const target: ObjectConfig = {
    name: 'contact',
    title: 'Contact',
    titlePlural: 'Contacts',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'name', type: 'text', title: 'Name' },
      { name: 'email', type: 'text', title: 'Email' },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Contacts', columns: [{ property: 'name' }] }],
  };
  const owner: ObjectConfig = {
    name: 'thing',
    title: 'Thing',
    titlePlural: 'Things',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'contact', type: 'ref', target: 'contact', title: 'Contact' },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Things', columns: [{ property: 'id' }] }],
    views: [
      {
        name: 'default',
        title: 'Thing',
        fields: [
          { property: 'contact' },
          { property: 'contact.name', readOnly: true, label: 'Contact name' },
          { property: 'contact.email', readOnly: true, label: 'Contact email' },
        ],
      },
    ],
  };
  const resolve = (n: string) => (n === 'contact' ? target : undefined);

  it('emits derived specs that point back to the local ref', () => {
    const specs = viewFields(owner, 'default', 'edit', resolve);
    expect(specs.map((s) => s.path)).toEqual(['contact', 'contact.name', 'contact.email']);
    expect(specs[1]?.derivedFromRef).toBe('contact');
    expect(specs[2]?.derivedFromRef).toBe('contact');
    expect(specs[1]?.editable).toBe(false);
    expect(specs[2]?.property.name).toBe('email');
  });

  it('skips a dotted path without a resolver', () => {
    const specs = viewFields(owner, 'default', 'edit');
    expect(specs.map((s) => s.path)).toEqual(['contact']);
  });
});

describe('assembleValues', () => {
  it('emits only editable simple fields', () => {
    const specs: ObjectConfig = {
      name: 'thing',
      title: 'Thing',
      titlePlural: 'Things',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'label', type: 'text', title: 'Label' },
        { name: 'fixed', type: 'text', title: 'Fixed', editable: 'never' },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Things', columns: [{ property: 'label' }] }],
      views: [{ name: 'default', title: 'Thing', fields: [{ property: 'label' }, { property: 'fixed' }] }],
    };
    const out = assembleValues(specs, 'default', { label: 'hello', fixed: 'ignored' }, 'create');
    expect(out).toEqual({ label: 'hello' });
  });
});

describe('ConfigSchema accepts an optional views array', () => {
  it('loads a config whose object declares views', () => {
    const c = loadConfig({
      version: '1',
      objects: [withView],
    });
    expect(c.objects[0]?.views?.[0]?.name).toBe('default');
  });
  it('loads a config with no views array', () => {
    const c = loadConfig({
      version: '1',
      objects: [withoutView],
    });
    expect(c.objects[0]?.views).toBeUndefined();
  });
});

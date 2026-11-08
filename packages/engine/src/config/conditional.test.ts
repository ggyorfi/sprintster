import { describe, it, expect } from 'vitest';
import { loadConfig } from './loader.js';
import { compileProperty } from './compile.js';
import { isVisible, viewFields } from '../engine/view.js';

function product(fields: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    version: '1',
    objects: [
      {
        name: 'product',
        title: 'Product',
        titlePlural: 'Products',
        route: 'products',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'stockBy', type: 'enum', values: ['total', 'size'], default: 'total' },
          { name: 'stock', type: 'integer' },
          { name: 'stockBySize', type: 'array', uniqueBy: 'size', item: { properties: [{ name: 'size', type: 'text' }, { name: 'stock', type: 'integer' }] } },
          { name: 'removed', type: 'boolean', system: true },
          ...((extra['properties'] as unknown[]) ?? []),
        ],
        views: [{ name: 'default', title: 'Product', fields }],
      },
    ],
  };
}

describe('visibleWhen', () => {
  const config = () =>
    loadConfig(
      product([
        { property: 'stockBy' },
        { property: 'stock', visibleWhen: { property: 'stockBy', equals: 'total' } },
        { kind: 'fieldset', title: 'Sizes', visibleWhen: { property: 'stockBy', equals: 'size' }, fields: [{ property: 'stockBySize', layout: 'table' }] },
      ]),
    );

  it('carries the field or fieldset condition into each spec and evaluates it against the inputs', () => {
    const specs = viewFields(config().objects[0]!, 'default', 'edit');
    const byPath = new Map(specs.map((s) => [s.path, s]));
    expect(isVisible(byPath.get('stock')!, { stockBy: 'total' })).toBe(true);
    expect(isVisible(byPath.get('stock')!, { stockBy: 'size' })).toBe(false);
    expect(isVisible(byPath.get('stockBySize')!, { stockBy: 'size' })).toBe(true);
    expect(byPath.get('stockBySize')!.layout).toBe('table');
    expect(isVisible(byPath.get('stockBy')!, {})).toBe(true);
  });

  it('rejects an unknown property, a value the enum lacks, and a non-boolean for a boolean', () => {
    expect(() => loadConfig(product([{ property: 'stock', visibleWhen: { property: 'nope', equals: 'x' } }]))).toThrow(/unknown property 'nope'/);
    expect(() => loadConfig(product([{ property: 'stock', visibleWhen: { property: 'stockBy', equals: 'colour' } }]))).toThrow(/not a value of 'stockBy'/);
    expect(() =>
      loadConfig(product([{ property: 'stock', visibleWhen: { property: 'flag', equals: 'yes' } }], { properties: [{ name: 'flag', type: 'boolean' }] })),
    ).toThrow(/must be true or false/);
  });

  it('rejects a table layout on a property that is not an array', () => {
    expect(() => loadConfig(product([{ property: 'stock', layout: 'table' }]))).toThrow(/layout 'table'/);
  });
});

describe('uniqueBy', () => {
  const config = () => loadConfig(product([{ property: 'stockBySize' }]));
  const schema = () => compileProperty(config().objects[0]!.properties.find((p) => p.name === 'stockBySize')!);

  it('refuses two items with the same value, pointing at the repeat', () => {
    const result = schema().safeParse([{ size: 'M', stock: 1 }, { size: 'P', stock: 0 }, { size: 'M', stock: 2 }]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([2, 'size']);
  });

  it('accepts distinct values', () => {
    expect(schema().safeParse([{ size: 'M', stock: 1 }, { size: 'P', stock: 0 }]).success).toBe(true);
  });

  it('rejects a uniqueBy that is not an item property', () => {
    const raw = product([{ property: 'stockBySize' }]) as { objects: Array<{ properties: Array<Record<string, unknown>> }> };
    raw.objects[0]!.properties[3]!['uniqueBy'] = 'colour';
    expect(() => loadConfig(raw)).toThrow(/uniqueBy 'colour'/);
  });
});

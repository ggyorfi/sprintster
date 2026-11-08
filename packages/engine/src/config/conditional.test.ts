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

describe('columnOptions', () => {
  function raw(path: string, column = 'size'): unknown {
    return {
      version: '1',
      objects: [
        {
          name: 'settings',
          title: 'Settings',
          titlePlural: 'Settings',
          route: 'settings',
          singleton: true,
          properties: [
            { name: 'id', type: 'id', strategy: 'uuid', system: true },
            { name: 'sizes', type: 'array', item: { properties: [{ name: 'first', type: 'text' }] } },
          ],
          views: [{ name: 'default', title: 'Settings', fields: [{ property: 'sizes' }] }],
        },
        ...(product([{ property: 'stockBySize', layout: 'table', columnOptions: { [column]: path } }]) as { objects: unknown[] }).objects,
      ],
    };
  }

  it('carries the source of a column into the spec', () => {
    const product = loadConfig(raw('settings.sizes.first')).objects[1]!;
    expect(viewFields(product, 'default', 'edit')[0]!.columnOptions).toEqual({ size: { object: 'settings', array: 'sizes', column: 'first' } });
  });

  it('rejects an unknown column, source object or source column', () => {
    expect(() => loadConfig(raw('settings.sizes.first', 'colour'))).toThrow(/'colour' is not one of its item properties/);
    expect(() => loadConfig(raw('nope.sizes.first'))).toThrow(/existing object/);
    expect(() => loadConfig(raw('settings.sizes.missing'))).toThrow(/no array 'sizes' with a column 'missing'/);
    expect(() => loadConfig(raw('product.stockBySize.size'))).toThrow(/not a singleton/);
  });
});

describe('variant form helpers', () => {
  it('evaluates notEquals', () => {
    const spec = viewFields(
      loadConfig(product([{ property: 'stock', visibleWhen: { property: 'stockBy', notEquals: 'size' } }])).objects[0]!,
      'default',
      'edit',
    )[0]!;
    expect(isVisible(spec, { stockBy: 'total' })).toBe(true);
    expect(isVisible(spec, { stockBy: 'size' })).toBe(false);
  });

  it('refuses a repeated combination, but not a repeat of one column', () => {
    const schema = compileProperty({ name: 'rows', type: 'array', uniqueBy: ['a', 'b'], item: { properties: [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }] } });
    expect(schema.safeParse([{ a: 'M', b: 'Ruby' }, { a: 'M', b: 'Topaz' }]).success).toBe(true);
    const repeat = schema.safeParse([{ a: 'M', b: 'Ruby' }, { a: 'M', b: 'Ruby' }]);
    expect(repeat.success).toBe(false);
    expect(repeat.error?.issues[0]?.message).toBe('M / Ruby is already in the list');
  });

  it('rejects a label source that is not a text property of a singleton, and an unknown column', () => {
    expect(() => loadConfig(product([{ property: 'stock', labelFrom: 'product.stock' }]))).toThrow(/not a singleton/);
    expect(() => loadConfig(product([{ property: 'stockBySize', columnVisibleWhen: { colour: { property: 'stockBy', equals: 'size' } } }]))).toThrow(/'colour' is not one of its item properties/);
  });
});

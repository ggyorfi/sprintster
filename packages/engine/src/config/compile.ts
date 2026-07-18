import { z } from 'zod';
import { PenceString } from '../money/index.js';
import { IsoInstant } from '../time/index.js';
import type { ObjectConfig, PropertyConfig } from './schema.js';

function baseSchema(prop: PropertyConfig): z.ZodTypeAny {
  switch (prop.type) {
    case 'id':
      return prop.strategy === 'uuid' ? z.string().uuid() : z.string().min(1);
    case 'text': {
      let s = z.string();
      const v = prop.validation;
      if (v?.minLength !== undefined) s = s.min(v.minLength);
      if (v?.maxLength !== undefined) s = s.max(v.maxLength);
      if (v?.format === 'email') s = s.email();
      return s;
    }
    case 'code':
    case 'markdown': {
      let s = z.string();
      const v = prop.validation;
      if (v?.minLength !== undefined) s = s.min(v.minLength);
      if (v?.maxLength !== undefined) s = s.max(v.maxLength);
      return s;
    }
    case 'enum':
      return z.enum(prop.values as [string, ...string[]]);
    case 'money':
      return PenceString;
    case 'integer': {
      let s = z.number().int();
      const v = prop.validation;
      if (v?.min !== undefined) s = s.min(v.min);
      if (v?.max !== undefined) s = s.max(v.max);
      return s;
    }
    case 'date':
      return z.iso.date();
    case 'datetime':
      return IsoInstant;
    case 'ref':
      return z.string().min(1);
    case 'refs': {
      let s = z.array(z.string().min(1));
      const v = prop.validation;
      if (v?.minItems !== undefined) s = s.min(v.minItems);
      if (v?.maxItems !== undefined) s = s.max(v.maxItems);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'image':
      return z
        .object({
          hash: z.string().min(1),
          filename: z.string(),
          contentType: z.string(),
          size: z.number().int().nonnegative(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          alt: z.string().optional(),
        })
        .strict();
    case 'sequence':
      return z.number().int();
    case 'object':
      return compileObject(prop);
    case 'array': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const sub of prop.item.properties) shape[sub.name] = compileProperty(sub);
      let s = z.array(z.object(shape));
      const v = prop.validation;
      if (v?.minItems !== undefined) s = s.min(v.minItems);
      if (v?.maxItems !== undefined) s = s.max(v.maxItems);
      return s;
    }
  }
}

function valueSchema(prop: PropertyConfig): z.ZodTypeAny {
  const schema = baseSchema(prop);
  return prop.nullable ? schema.nullable() : schema;
}

export function compileProperty(prop: PropertyConfig): z.ZodTypeAny {
  let schema = valueSchema(prop);
  if (prop.default !== undefined) {
    schema = schema.default(prop.default);
  } else if (prop.type === 'array' || prop.type === 'refs') {
    schema = schema.default([]);
  } else if (prop.validation?.required) {
    return schema;
  } else if (prop.nullable) {
    schema = schema.default(null);
  } else {
    schema = schema.optional();
  }
  return schema;
}

export function compileObject(obj: { properties: PropertyConfig[] }): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const prop of obj.properties) {
    shape[prop.name] = compileProperty(prop);
  }
  return z.object(shape);
}

type ObjectShape = Pick<ObjectConfig, 'properties' | 'lifecycle'>;

function lifecycleFieldName(lifecycle: ObjectConfig['lifecycle']): string {
  return 'softDelete' in lifecycle ? lifecycle.softDelete : lifecycle.statusField;
}

export function compileCreateSchema(obj: ObjectShape): z.ZodTypeAny {
  const lifecycleField = lifecycleFieldName(obj.lifecycle);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const prop of obj.properties) {
    if (prop.name === lifecycleField) continue;
    if (prop.editable === 'never') continue;
    if (prop.type === 'sequence') continue; // daemon-allocated, never authored
    if (prop.type === 'id') {
      if (prop.strategy === 'sequence') continue;
      shape[prop.name] = valueSchema(prop);
      continue;
    }
    shape[prop.name] = compileProperty(prop);
  }
  return z.object(shape).strict();
}

export function compileUpdateSchema(obj: ObjectShape): z.ZodTypeAny {
  const lifecycleField = lifecycleFieldName(obj.lifecycle);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const prop of obj.properties) {
    if (prop.system) continue;
    if (prop.type === 'id') continue;
    if (prop.type === 'sequence') continue; // daemon-allocated, frozen
    if (prop.name === lifecycleField) continue;
    if (prop.editable === 'onCreate' || prop.editable === 'never') continue;
    shape[prop.name] = valueSchema(prop).optional();
  }
  return z.object(shape).strict();
}

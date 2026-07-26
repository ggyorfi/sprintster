import type { ObjectConfig, PropertyConfig } from '../config/schema.js';

export function singletonId(obj: ObjectConfig): string {
  return obj.name;
}

function zeroValue(prop: PropertyConfig): unknown {
  switch (prop.type) {
    case 'text':
    case 'code':
    case 'markdown':
      return '';
    case 'money':
      return '0';
    case 'integer':
    case 'sequence':
      return 0;
    case 'boolean':
      return false;
    case 'refs':
    case 'array':
      return [];
    case 'object':
      return synthesizeProperties(prop.properties);
    case 'id':
    case 'enum':
    case 'date':
    case 'datetime':
    case 'ref':
    case 'image':
      return null;
  }
}

function synthesizeProperties(properties: PropertyConfig[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of properties) {
    out[prop.name] = prop.default !== undefined ? prop.default : zeroValue(prop);
  }
  return out;
}

// A read-time projection of an unsaved singleton; nothing here is persisted.
export function synthesizeSingleton(obj: ObjectConfig): Record<string, unknown> {
  return { ...synthesizeProperties(obj.properties), id: singletonId(obj) };
}

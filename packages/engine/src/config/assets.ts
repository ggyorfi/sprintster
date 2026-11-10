import type { ObjectConfig, PropertyConfig } from './schema.js';

export type AssetFileProperty = Extract<PropertyConfig, { type: 'image' | 'file' }>;

export function isAssetFileProperty(prop: PropertyConfig): prop is AssetFileProperty {
  return prop.type === 'image' || prop.type === 'file';
}

// loadConfig guarantees the nominated assets object has exactly one.
export function assetFileProperty(obj: ObjectConfig | undefined): AssetFileProperty | undefined {
  return obj?.properties.find(isAssetFileProperty);
}

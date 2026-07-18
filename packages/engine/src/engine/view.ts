import type { ObjectConfig, PropertyConfig, ViewFieldConfig, ViewFieldsetConfig, ViewItemConfig } from '../config/schema.js';
import type { ObjectResolver } from './list.js';

function isFieldset(item: ViewItemConfig): item is ViewFieldsetConfig {
  return 'kind' in item && item.kind === 'fieldset';
}

export type ViewMode = 'create' | 'edit' | 'view';

export interface ViewFieldSpec {
  path: string;
  property: PropertyConfig;
  label: string;
  placeholder: string;
  rows: number;
  group: string | null;
  editable: boolean;
  derivedFromRef: string | null;
  defaultInput: string;
}

function viewByName(obj: ObjectConfig, viewName: string) {
  return obj.views?.find((v) => v.name === viewName);
}

export function hasView(obj: ObjectConfig, viewName = 'default'): boolean {
  return viewByName(obj, viewName) !== undefined;
}

function resolveEditable(property: PropertyConfig, mode: ViewMode, fieldReadOnly: boolean | undefined): boolean {
  if (mode === 'view') return false;
  if (fieldReadOnly === true) return false;
  const editability = property.editable ?? 'always';
  if (editability === 'never') return false;
  if (mode === 'edit' && editability === 'onCreate') return false;
  return true;
}

export function parsePoundsToPence(pounds: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(pounds.trim());
  if (m === null) return null;
  const whole = Number.parseInt(m[1] ?? '0', 10);
  const frac = Number.parseInt((m[2] ?? '').padEnd(2, '0'), 10);
  return whole * 100 + frac;
}

export function penceToPounds(pence: string): string {
  const n = Number.parseInt(pence, 10);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const pounds = Math.floor(abs / 100);
  const cents = abs % 100;
  return cents === 0 ? `${sign}${pounds}` : `${sign}${pounds}.${String(cents).padStart(2, '0')}`;
}

export function toInput(property: PropertyConfig, value: unknown): string {
  if (property.type === 'array') return '';
  if (value === null || value === undefined) return '';
  if (property.type === 'money') return penceToPounds(String(value));
  if (property.type === 'refs') return JSON.stringify(Array.isArray(value) ? value : []);
  if (property.type === 'image') return JSON.stringify(value);
  return String(value);
}

type ArrayProperty = Extract<PropertyConfig, { type: 'array' }>;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Flatten an array value into the form's indexed flat keys (`path.0.sub`, `path.1.sub`, ...). */
export function arrayInitialValues(
  prop: ArrayProperty,
  path: string,
  value: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(value)) return out;
  value.forEach((item, i) => {
    const rec = (item ?? {}) as Record<string, unknown>;
    for (const sub of prop.item.properties) {
      out[`${path}.${i}.${sub.name}`] = toInput(sub, rec[sub.name]);
    }
  });
  return out;
}

/** Count items present in the form values for an array path (max index + 1). */
export function arrayItemCount(path: string, inputs: Record<string, string>): number {
  const re = new RegExp(`^${escapeRegExp(path)}\\.(\\d+)\\.`);
  let max = -1;
  for (const key of Object.keys(inputs)) {
    const m = re.exec(key);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Rebuild an array value from the indexed flat keys, dropping fully-empty items. */
export function regroupArray(
  prop: ArrayProperty,
  path: string,
  inputs: Record<string, string>,
): Array<Record<string, unknown>> {
  const count = arrayItemCount(path, inputs);
  const items: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const item: Record<string, unknown> = {};
    let anySet = false;
    for (const sub of prop.item.properties) {
      const v = toStorage(sub, inputs[`${path}.${i}.${sub.name}`] ?? '');
      item[sub.name] = v === undefined || v === '' ? null : v;
      if (item[sub.name] !== null) anySet = true;
    }
    if (anySet) items.push(item);
  }
  return items;
}

export function toStorage(property: PropertyConfig, input: string): unknown {
  const s = input.trim();
  switch (property.type) {
    case 'money': {
      if (s === '') return null;
      const pence = parsePoundsToPence(s);
      return pence === null ? s : String(pence);
    }
    case 'integer': {
      if (s === '') return undefined;
      const n = Number(s);
      return Number.isInteger(n) ? n : s;
    }
    case 'refs': {
      if (s === '') return [];
      try {
        const arr: unknown = JSON.parse(s);
        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    }
    case 'image': {
      if (s === '') return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }
    default:
      return s === '' ? (property.nullable ? null : '') : s;
  }
}

function processField(
  field: ViewFieldConfig,
  propByName: Map<string, PropertyConfig>,
  mode: ViewMode,
  resolveTarget: ObjectResolver | undefined,
  group: string | null,
): ViewFieldSpec | null {
  const segments = field.property.split('.');
  const first = segments[0];
  if (first === undefined) return null;
  const root = propByName.get(first);
  if (root === undefined) return null;

  if (segments.length === 1) {
    if (root.type === 'object') return null;
    return {
      path: root.name,
      property: root,
      label: field.label ?? root.title ?? root.name,
      placeholder: field.placeholder ?? '',
      rows: field.rows ?? 1,
      group,
      editable: resolveEditable(root, mode, field.readOnly),
      derivedFromRef: null,
      defaultInput: root.default !== undefined ? toInput(root, root.default) : '',
    };
  }

  if (root.type === 'object') {
    const leafName = segments[1];
    const leaf = root.properties.find((p) => p.name === leafName);
    if (leaf === undefined) return null;
    return {
      path: field.property,
      property: leaf,
      label: field.label ?? leaf.title ?? leaf.name,
      placeholder: field.placeholder ?? '',
      rows: field.rows ?? 1,
      group,
      editable: resolveEditable(leaf, mode, field.readOnly),
      derivedFromRef: null,
      defaultInput: leaf.default !== undefined ? toInput(leaf, leaf.default) : '',
    };
  }

  if (root.type === 'ref') {
    if (resolveTarget === undefined) return null;
    const target = resolveTarget(root.target);
    if (target === undefined) return null;
    const leafName = segments[segments.length - 1];
    const leaf = target.properties.find((p) => p.name === leafName);
    if (leaf === undefined) return null;
    return {
      path: field.property,
      property: leaf,
      label: field.label ?? leaf.title ?? leaf.name,
      placeholder: '',
      rows: 1,
      group,
      editable: false,
      derivedFromRef: root.name,
      defaultInput: '',
    };
  }

  return null;
}

export function viewFields(
  obj: ObjectConfig,
  viewName: string,
  mode: ViewMode,
  resolveTarget?: ObjectResolver,
): ViewFieldSpec[] {
  const view = viewByName(obj, viewName);
  if (view === undefined) return [];
  const propByName = new Map(obj.properties.map((p) => [p.name, p]));
  const specs: ViewFieldSpec[] = [];
  for (const item of view.fields) {
    if (isFieldset(item)) {
      for (const field of item.fields) {
        const spec = processField(field, propByName, mode, resolveTarget, item.title);
        if (spec !== null) specs.push(spec);
      }
    } else {
      const spec = processField(item, propByName, mode, resolveTarget, null);
      if (spec !== null) specs.push(spec);
    }
  }
  return specs;
}

function flattenViewItems(items: ReadonlyArray<ViewItemConfig>): ViewFieldConfig[] {
  const out: ViewFieldConfig[] = [];
  for (const item of items) {
    if (isFieldset(item)) {
      out.push(...item.fields);
    } else {
      out.push(item);
    }
  }
  return out;
}

export function assembleValues(
  obj: ObjectConfig,
  viewName: string,
  inputs: Record<string, string>,
  mode: ViewMode,
): Record<string, unknown> {
  const view = viewByName(obj, viewName);
  if (view === undefined) return {};
  const propByName = new Map(obj.properties.map((p) => [p.name, p]));
  const flat = flattenViewItems(view.fields);

  interface RootInfo {
    items: ViewFieldConfig[];
  }
  const byRoot = new Map<string, RootInfo>();
  for (const field of flat) {
    const segments = field.property.split('.');
    const first = segments[0];
    if (first === undefined) continue;
    const info = byRoot.get(first) ?? { items: [] };
    info.items.push(field);
    byRoot.set(first, info);
  }

  const out: Record<string, unknown> = {};
  for (const [rootName, info] of byRoot) {
    const root = propByName.get(rootName);
    if (root === undefined) continue;

    if (root.type === 'object') {
      const sub: Record<string, unknown> = {};
      let anySet = false;
      for (const subprop of root.properties) {
        const listed = info.items.find((i) => i.property === `${rootName}.${subprop.name}`);
        if (listed === undefined || !resolveEditable(subprop, mode, listed.readOnly)) {
          sub[subprop.name] = null;
          continue;
        }
        const v = toStorage(subprop, inputs[`${rootName}.${subprop.name}`] ?? '');
        sub[subprop.name] = v ?? null;
        if (v !== null && v !== undefined && v !== '') anySet = true;
      }
      out[rootName] = anySet ? sub : root.nullable ? null : sub;
      continue;
    }

    if (root.type === 'array') {
      const direct = info.items.find((i) => i.property === rootName);
      if (direct === undefined) continue;
      if (!resolveEditable(root, mode, direct.readOnly)) continue;
      out[rootName] = regroupArray(root, rootName, inputs);
      continue;
    }

    if (root.type === 'ref' || root.type === 'refs' || root.type === 'image') {
      const direct = info.items.find((i) => i.property === rootName);
      if (direct === undefined) continue;
      if (!resolveEditable(root, mode, direct.readOnly)) continue;
      const v = toStorage(root, inputs[rootName] ?? '');
      if (v !== undefined) out[rootName] = v;
      continue;
    }

    const direct = info.items.find((i) => !i.property.includes('.'));
    if (direct === undefined) continue;
    if (!resolveEditable(root, mode, direct.readOnly)) continue;
    const v = toStorage(root, inputs[rootName] ?? '');
    if (v !== undefined) out[rootName] = v;
  }
  return out;
}

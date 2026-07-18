import { ConfigSchema, type Config, type ObjectConfig, type PropertyConfig } from './schema.js';

export function loadConfig(raw: unknown): Config {
  const config = ConfigSchema.parse(raw);
  validateSemantics(config);
  return config;
}

function validateSemantics(config: Config): void {
  const objectNames = config.objects.map((o) => o.name);
  assertUnique(objectNames, 'object name');
  const knownObjects = new Set(objectNames);
  const objectsByName = new Map(config.objects.map((o) => [o.name, o]));
  for (const obj of config.objects) {
    checkProperties(obj.name, obj.properties, knownObjects);
    checkLifecycle(obj);
    checkCommands(obj);
    checkViews(obj, objectsByName);
    checkListActions(obj);
  }
}

function checkViews(obj: ObjectConfig, objectsByName: Map<string, ObjectConfig>): void {
  if (obj.views === undefined) return;
  assertUnique(obj.views.map((v) => v.name), `view name in '${obj.name}'`);
  const propByName = new Map(obj.properties.map((p) => [p.name, p]));
  for (const view of obj.views) {
    for (const item of view.fields) {
      if ('kind' in item && (item as { kind?: string }).kind === 'fieldset') {
        const fs = item as { title: string; fields: Array<{ property: string; readOnly?: boolean | undefined }> };
        for (const field of fs.fields) {
          checkViewField(obj, view.name, field, propByName, objectsByName);
        }
      } else {
        checkViewField(obj, view.name, item as { property: string; readOnly?: boolean | undefined }, propByName, objectsByName);
      }
    }
  }
}

function checkViewField(
  obj: ObjectConfig,
  viewName: string,
  field: { property: string; readOnly?: boolean | undefined },
  propByName: Map<string, PropertyConfig>,
  objectsByName: Map<string, ObjectConfig>,
): void {
  const segments = field.property.split('.');
  const first = segments[0];
  if (first === undefined) return;
  const root = propByName.get(first);
  if (root === undefined) {
    throw new Error(`view field '${obj.name}.${viewName}.${field.property}' references unknown property '${first}'`);
  }
  if (segments.length === 1) {
    if (root.type === 'object') {
      throw new Error(
        `view field '${obj.name}.${viewName}.${field.property}': '${first}' is an object property; address its sub-fields explicitly (e.g. '${first}.<sub>') or wrap them in a fieldset`,
      );
    }
    return;
  }
  if (root.type === 'object') {
    const leafName = segments[1];
    const leaf = root.properties.find((p) => p.name === leafName);
    if (leaf === undefined) {
      throw new Error(
        `view field '${obj.name}.${viewName}.${field.property}' references unknown sub-property '${leafName}' on object '${first}'`,
      );
    }
    return;
  }
  if (root.type !== 'ref') {
    throw new Error(
      `view field '${obj.name}.${viewName}.${field.property}' uses a dotted path but '${first}' is not an object or ref property`,
    );
  }
  if (field.readOnly !== true) {
    throw new Error(
      `view field '${obj.name}.${viewName}.${field.property}' traverses a ref; it must be marked readOnly`,
    );
  }
  const target = objectsByName.get(root.target);
  if (target === undefined) return;
  const leafName = segments[segments.length - 1];
  const leaf = target.properties.find((p) => p.name === leafName);
  if (leaf === undefined) {
    throw new Error(
      `view field '${obj.name}.${viewName}.${field.property}' references unknown property '${leafName}' on target '${root.target}'`,
    );
  }
}

function checkListActions(obj: ObjectConfig): void {
  const viewNames = new Set((obj.views ?? []).map((v) => v.name));
  for (const list of obj.lists) {
    const actions = list.actions ?? [];
    assertUnique(actions.map((a) => a.hotkey), `list action hotkey in '${obj.name}.${list.name}'`);
    for (const action of actions) {
      if (action.kind === 'delete') {
        if (action.view !== undefined) {
          throw new Error(`list action '${obj.name}.${list.name}.${action.hotkey}': kind 'delete' must not set 'view'`);
        }
        if (!('softDelete' in obj.lifecycle)) {
          throw new Error(`list action '${obj.name}.${list.name}.${action.hotkey}': kind 'delete' requires a softDelete lifecycle`);
        }
        continue;
      }
      if (action.view === undefined) {
        throw new Error(`list action '${obj.name}.${list.name}.${action.hotkey}': kind '${action.kind}' requires a 'view'`);
      }
      if (!viewNames.has(action.view)) {
        throw new Error(
          `list action '${obj.name}.${list.name}.${action.hotkey}': view '${action.view}' is not declared on '${obj.name}'`,
        );
      }
    }
  }
}

function checkCommands(obj: ObjectConfig): void {
  if (obj.commands === undefined || obj.commands.length === 0) return;
  if (!('statusField' in obj.lifecycle)) {
    throw new Error(`object '${obj.name}': transition commands require a statusField lifecycle`);
  }
  const statusFieldName = obj.lifecycle.statusField;
  const statusProp = obj.properties.find((p) => p.name === statusFieldName);
  if (statusProp === undefined || statusProp.type !== 'enum') {
    throw new Error(`object '${obj.name}': statusField '${statusFieldName}' must be an enum property`);
  }
  const values = new Set(statusProp.values);
  assertUnique(
    obj.commands.map((c) => c.name),
    `command name in '${obj.name}'`,
  );
  for (const cmd of obj.commands) {
    for (const from of cmd.transition.from) {
      if (!values.has(from)) {
        throw new Error(`command '${obj.name}.${cmd.name}': from-state '${from}' is not a value of '${statusFieldName}'`);
      }
    }
    if (!values.has(cmd.transition.to)) {
      throw new Error(`command '${obj.name}.${cmd.name}': to-state '${cmd.transition.to}' is not a value of '${statusFieldName}'`);
    }
  }
}

// `unique` is enforced per-object over live records via a reserved stream, so it only applies to top-level scalar fields.
const UNIQUE_INCAPABLE_TYPES = new Set(['id', 'sequence', 'object', 'array', 'refs']);

function checkProperties(scope: string, properties: PropertyConfig[], knownObjects: Set<string>, nested = false): void {
  assertUnique(
    properties.map((p) => p.name),
    `property name in '${scope}'`,
  );
  for (const prop of properties) {
    if (prop.type === 'enum' && prop.default !== undefined && !prop.values.includes(prop.default as string)) {
      throw new Error(
        `enum property '${scope}.${prop.name}' has default '${String(prop.default)}', not one of its values`,
      );
    }
    if ((prop.type === 'ref' || prop.type === 'refs') && !knownObjects.has(prop.target)) {
      throw new Error(`${prop.type} property '${scope}.${prop.name}' has target '${prop.target}', not a known object`);
    }
    if (prop.validation?.unique === true) {
      if (nested) {
        throw new Error(`unique property '${scope}.${prop.name}' is nested; unique is only supported on top-level scalar fields`);
      }
      if (UNIQUE_INCAPABLE_TYPES.has(prop.type)) {
        throw new Error(`unique property '${scope}.${prop.name}' has type '${prop.type}'; unique is only supported on scalar fields`);
      }
    }
    if (prop.type === 'object') {
      checkProperties(`${scope}.${prop.name}`, prop.properties, knownObjects, true);
    }
  }
}

function checkLifecycle(obj: ObjectConfig): void {
  const field = 'softDelete' in obj.lifecycle ? obj.lifecycle.softDelete : obj.lifecycle.statusField;
  if (!obj.properties.some((p) => p.name === field)) {
    throw new Error(`lifecycle field '${field}' is not a property of object '${obj.name}'`);
  }
}

function assertUnique(names: string[], label: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate ${label}: '${name}'`);
    seen.add(name);
  }
}

import { ConfigSchema, type Config, type ObjectConfig, type PropertyConfig } from './schema.js';
import { objectRoute, slugify, RESERVED_ROUTES } from './route.js';

export function loadConfig(raw: unknown): Config {
  const config = ConfigSchema.parse(raw);
  validateSemantics(config);
  // Resolve every route up front so `/config` consumers never re-derive the slug rule.
  return { ...config, objects: config.objects.map((o) => ({ ...o, route: objectRoute(o) })) };
}

const ASSETS_DOC = 'docs/objects-and-properties.md#assets';

function validateSemantics(config: Config): void {
  const objectNames = config.objects.map((o) => o.name);
  assertUnique(objectNames, 'object name');
  checkRoutes(config);
  checkAssets(config);
  const knownObjects = new Set(objectNames);
  const objectsByName = new Map(config.objects.map((o) => [o.name, o]));
  for (const obj of config.objects) {
    checkProperties(obj.name, obj.properties, knownObjects);
    checkViews(obj, objectsByName);
    if (obj.singleton === true) {
      checkSingleton(obj);
    } else {
      if (obj.lifecycle === undefined) {
        throw new Error(`object '${obj.name}' must declare a lifecycle unless it is a singleton`);
      }
      checkLifecycle(obj);
      checkCommands(obj);
      checkListActions(obj);
    }
  }
}

function checkRoutes(config: Config): void {
  const ownerByRoute = new Map<string, string>();
  for (const obj of config.objects) {
    if (obj.route !== undefined && slugify(obj.route) !== obj.route) {
      throw new Error(
        `object '${obj.name}' route '${obj.route}' is not a slug; use '${slugify(obj.route)}'`,
      );
    }
    const route = objectRoute(obj);
    if (route === '') {
      throw new Error(
        `object '${obj.name}' titlePlural '${obj.titlePlural}' slugs to nothing; give it an explicit 'route'`,
      );
    }
    if (RESERVED_ROUTES.has(route)) {
      throw new Error(
        `object '${obj.name}' route '${route}' is reserved by the daemon ` +
          `(${[...RESERVED_ROUTES].join(', ')}); give it an explicit 'route'`,
      );
    }
    const owner = ownerByRoute.get(route);
    if (owner !== undefined) {
      throw new Error(`duplicate object route '${route}': '${owner}' and '${obj.name}'`);
    }
    ownerByRoute.set(route, obj.name);
  }
}

// A singleton is projected from its defaults before the first save, so a required field with no default could never be satisfied.
function checkSingleton(obj: ObjectConfig): void {
  // The form is a singleton's entire UI, so with no view there is nothing to render.
  if (obj.views === undefined || obj.views.length === 0) {
    throw new Error(`singleton '${obj.name}' must declare a view; it is opened as a form, not a list`);
  }
  for (const prop of obj.properties) {
    if (prop.validation?.required === true && prop.default === undefined) {
      throw new Error(
        `singleton '${obj.name}' field '${prop.name}' is required but has no default; required singleton fields must declare one`,
      );
    }
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
        if (obj.lifecycle === undefined || !('softDelete' in obj.lifecycle)) {
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
  if (obj.lifecycle === undefined || !('statusField' in obj.lifecycle)) {
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
const UNIQUE_INCAPABLE_TYPES = new Set(['id', 'sequence', 'object', 'array', 'refs', 'image']);

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
    if (prop.validation?.caseInsensitive === true && prop.validation?.unique !== true) {
      throw new Error(`property '${scope}.${prop.name}' sets caseInsensitive without unique; it only applies to unique fields`);
    }
    if (prop.type === 'object') {
      checkProperties(`${scope}.${prop.name}`, prop.properties, knownObjects, true);
    }
  }
}

function checkLifecycle(obj: ObjectConfig): void {
  if (obj.lifecycle === undefined) return;
  const field = 'softDelete' in obj.lifecycle ? obj.lifecycle.softDelete : obj.lifecycle.statusField;
  if (!obj.properties.some((p) => p.name === field)) {
    throw new Error(`lifecycle field '${field}' is not a property of object '${obj.name}'`);
  }
}

// In-body images resolve /assets/<id> against one nominated object, so asking for them without naming it cannot work.
function checkAssets(config: Config): void {
  const named = config.assets;
  if (named !== undefined) {
    const obj = config.objects.find((o) => o.name === named);
    if (obj === undefined) {
      throw new Error(
        `'assets' names unknown object '${named}'; define that object, or point 'assets' at an existing one. See ${ASSETS_DOC}`,
      );
    }
    const files = obj.properties.filter((p) => p.type === 'image');
    if (files.length === 0) {
      throw new Error(
        `'assets' object '${named}' has no image property; an asset object needs one to hold its file. See ${ASSETS_DOC}`,
      );
    }
    if (files.length > 1) {
      throw new Error(
        `'assets' object '${named}' has ${files.length} image properties ` +
          `(${files.map((p) => `'${p.name}'`).join(', ')}); it must have exactly one, so /assets/<id> knows which file to ` +
          `serve. See ${ASSETS_DOC}`,
      );
    }
    return;
  }
  for (const obj of config.objects) {
    for (const prop of obj.properties) {
      if (prop.type === 'markdown' && prop.images === true) {
        throw new Error(
          `property '${obj.name}.${prop.name}' asks for in-body images, but no 'assets' object is named; ` +
            `define an asset object and set 'assets' to its name. See ${ASSETS_DOC}`,
        );
      }
    }
  }
}

function assertUnique(names: string[], label: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`duplicate ${label}: '${name}'`);
    seen.add(name);
  }
}

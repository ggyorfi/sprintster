import { ConfigSchema, type Config, type ObjectConfig, type PropertyConfig, type ViewFieldConfig, type ViewFieldsetConfig, type VisibleWhen } from './schema.js';
import { filterOptionProblem, resolveSort } from '../engine/list-query.js';
import { objectRoute, slugify, RESERVED_ROUTES } from './route.js';
import { isAssetFileProperty } from './assets.js';
import { TIMESTAMP_FIELDS } from '../engine/reducer.js';

export function loadConfig(raw: unknown): Config {
  const config = ConfigSchema.parse(raw);
  validateSemantics(config);
  return config;
}

const ASSETS_DOC = 'docs/objects-and-properties.md#assets';

function validateSemantics(config: Config): void {
  const objectNames = config.objects.map((o) => o.name);
  assertUnique(objectNames, 'object name');
  checkRoutes(config);
  checkAuth(config);
  checkAssets(config);
  if (config.locales !== undefined) assertUnique(config.locales, 'locale');
  const knownObjects = new Set(objectNames);
  const objectsByName = new Map(config.objects.map((o) => [o.name, o]));
  for (const obj of config.objects) {
    checkProperties(obj.name, obj.properties, knownObjects, config.locales !== undefined);
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
      checkThumbnails(obj, objectsByName);
      checkColumnSums(obj);
    }
    for (const list of obj.lists) {
      const groups = (list.filters ?? []).map((f) => f.label);
      assertUnique(groups, `filter of list '${obj.name}.${list.name}'`);
      for (const f of list.filters ?? []) {
        assertUnique(f.options.map((o) => o.label), `option of filter '${obj.name}.${list.name}.${f.label}'`);
        for (const o of f.options) {
          const problem = filterOptionProblem(obj, o);
          if (problem !== null) throw new Error(`filter '${obj.name}.${list.name}.${f.label}:${o.label}': ${problem}`);
        }
      }
      if (list.sort === undefined) continue;
      try {
        resolveSort(obj, list.sort, config.objects, config.locales ?? []);
      } catch (err) {
        throw new Error(`list '${obj.name}.${list.name}' sort: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

function checkRoutes(config: Config): void {
  const ownerByRoute = new Map<string, string>();
  for (const obj of config.objects) {
    const route = obj.route;
    if (slugify(route) !== route) {
      throw new Error(`object '${obj.name}' route '${route}' is not a slug; use '${slugify(route)}'`);
    }
    if (RESERVED_ROUTES.has(route)) {
      throw new Error(
        `object '${obj.name}' route '${route}' is reserved by the daemon (${[...RESERVED_ROUTES].join(', ')})`,
      );
    }
    const owner = ownerByRoute.get(route);
    if (owner !== undefined) {
      throw new Error(`duplicate object route '${route}': '${owner}' and '${obj.name}'`);
    }
    ownerByRoute.set(route, obj.name);
  }
}

// The daemon would answer an auth path that starts with one of its own routes, so the host never could.
function checkAuth(config: Config): void {
  if (config.auth === undefined) return;
  const daemonRoutes = new Set([...RESERVED_ROUTES, ...config.objects.map(objectRoute)]);
  for (const [name, path] of Object.entries(config.auth)) {
    const first = path.split('/')[1] ?? '';
    if (first === '' || daemonRoutes.has(first)) {
      throw new Error(`auth ${name} path '${path}' must start with a segment the daemon does not serve`);
    }
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
        const fs = item as ViewFieldsetConfig;
        checkVisibleWhen(`fieldset '${obj.name}.${view.name}.${fs.title}'`, fs.visibleWhen, propByName);
        for (const field of fs.fields) {
          checkViewField(obj, view.name, field, propByName, objectsByName);
        }
      } else {
        checkViewField(obj, view.name, item as ViewFieldConfig, propByName, objectsByName);
      }
    }
  }
}

function checkColumnOptions(obj: ObjectConfig, viewName: string, field: ViewFieldConfig, propByName: Map<string, PropertyConfig>, objectsByName: Map<string, ObjectConfig>): void {
  if (field.columnOptions === undefined) return;
  const where = `view field '${obj.name}.${viewName}.${field.property}' columnOptions`;
  const own = propByName.get(field.property);
  if (own?.type !== 'array') throw new Error(`${where}: only an array property has columns`);
  for (const [column, path] of Object.entries(field.columnOptions)) {
    if (!own.item.properties.some((p) => p.name === column)) throw new Error(`${where}: '${column}' is not one of its item properties`);
    const [objectName, arrayName, sourceColumn, ...rest] = path.split('.');
    const source = objectName === undefined ? undefined : objectsByName.get(objectName);
    if (source === undefined || arrayName === undefined || sourceColumn === undefined || rest.length > 0) {
      throw new Error(`${where}: '${path}' must name '<object>.<array>.<column>' of an existing object`);
    }
    if (source.singleton !== true) throw new Error(`${where}: '${objectName}' is not a singleton, so it has no one list to offer`);
    const list = source.properties.find((p) => p.name === arrayName);
    if (list?.type !== 'array' || !list.item.properties.some((p) => p.name === sourceColumn)) {
      throw new Error(`${where}: '${objectName}' has no array '${arrayName}' with a column '${sourceColumn}'`);
    }
  }
}

const CONDITION_TYPES = new Set<PropertyConfig['type']>(['enum', 'boolean', 'text', 'integer', 'ref']);

function checkVisibleWhen(where: string, cond: VisibleWhen | undefined, propByName: Map<string, PropertyConfig>): void {
  if (cond === undefined) return;
  const prop = propByName.get(cond.property);
  if (prop === undefined) throw new Error(`${where} visibleWhen names unknown property '${cond.property}'`);
  if (!CONDITION_TYPES.has(prop.type)) throw new Error(`${where} visibleWhen cannot test a ${prop.type} property`);
  const value = 'equals' in cond ? cond.equals : cond.notEquals;
  if (prop.type === 'enum' && !prop.values.includes(String(value))) {
    throw new Error(`${where} visibleWhen: '${String(value)}' is not a value of '${cond.property}' (${prop.values.join(', ')})`);
  }
  if (prop.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${where} visibleWhen: '${cond.property}' is boolean, so the value must be true or false`);
}

function checkLabelSource(where: string, path: string, objectsByName: Map<string, ObjectConfig>): void {
  const [objectName, propertyName, ...rest] = path.split('.');
  const source = objectName === undefined ? undefined : objectsByName.get(objectName);
  if (source === undefined || propertyName === undefined || rest.length > 0) throw new Error(`${where} '${path}' must name '<object>.<property>' of an existing object`);
  if (source.singleton !== true) throw new Error(`${where}: '${objectName}' is not a singleton, so it has no one value to show`);
  if (source.properties.find((p) => p.name === propertyName)?.type !== 'text') throw new Error(`${where}: '${objectName}.${propertyName}' is not a text property`);
}

function checkFieldLabels(obj: ObjectConfig, viewName: string, field: ViewFieldConfig, propByName: Map<string, PropertyConfig>, objectsByName: Map<string, ObjectConfig>): void {
  const where = `view field '${obj.name}.${viewName}.${field.property}'`;
  if (field.labelFrom !== undefined) checkLabelSource(`${where} labelFrom`, field.labelFrom, objectsByName);
  if (field.columnLabelsFrom === undefined && field.columnVisibleWhen === undefined) return;
  const own = propByName.get(field.property);
  if (own?.type !== 'array') throw new Error(`${where}: only an array property has columns`);
  const assertColumn = (column: string) => {
    if (!own.item.properties.some((p) => p.name === column)) throw new Error(`${where}: '${column}' is not one of its item properties`);
  };
  for (const [column, path] of Object.entries(field.columnLabelsFrom ?? {})) {
    assertColumn(column);
    checkLabelSource(`${where} columnLabelsFrom`, path, objectsByName);
  }
  for (const [column, cond] of Object.entries(field.columnVisibleWhen ?? {})) {
    assertColumn(column);
    checkVisibleWhen(`${where} column '${column}'`, cond, propByName);
  }
}

const PLACEHOLDER_SOURCES = new Set<PropertyConfig['type']>(['text', 'markdown', 'code', 'integer', 'money', 'date', 'datetime', 'enum']);

function checkPlaceholderFrom(obj: ObjectConfig, viewName: string, field: ViewFieldConfig, objectsByName: Map<string, ObjectConfig>): void {
  if (field.placeholderFrom === undefined) return;
  const where = `view field '${obj.name}.${viewName}.${field.property}' placeholderFrom '${field.placeholderFrom}'`;
  const [objectName, propertyName, ...rest] = field.placeholderFrom.split('.');
  const source = objectName === undefined ? undefined : objectsByName.get(objectName);
  if (source === undefined || propertyName === undefined || rest.length > 0) {
    throw new Error(`${where} must name '<object>.<property>' of an existing object`);
  }
  if (source.singleton !== true) throw new Error(`${where}: '${objectName}' is not a singleton, so it has no one value to show`);
  const prop = source.properties.find((p) => p.name === propertyName);
  if (prop === undefined) throw new Error(`${where}: '${objectName}' has no property '${propertyName}'`);
  if (!PLACEHOLDER_SOURCES.has(prop.type)) throw new Error(`${where}: a ${prop.type} property cannot be shown as a placeholder`);
}

function checkViewField(
  obj: ObjectConfig,
  viewName: string,
  field: ViewFieldConfig,
  propByName: Map<string, PropertyConfig>,
  objectsByName: Map<string, ObjectConfig>,
): void {
  checkPlaceholderFrom(obj, viewName, field, objectsByName);
  checkColumnOptions(obj, viewName, field, propByName, objectsByName);
  checkFieldLabels(obj, viewName, field, propByName, objectsByName);
  checkVisibleWhen(`view field '${obj.name}.${viewName}.${field.property}'`, field.visibleWhen, propByName);
  if (field.layout === 'table' && propByName.get(field.property)?.type !== 'array') {
    throw new Error(`view field '${obj.name}.${viewName}.${field.property}' uses layout 'table', which only an array property has`);
  }
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

function checkThumbnails(obj: ObjectConfig, objectsByName: Map<string, ObjectConfig>): void {
  for (const list of obj.lists) {
    for (const col of list.columns) {
      if (col.thumbnail !== true) continue;
      const where = `list column '${obj.name}.${list.name}.${col.property}'`;
      const prop = obj.properties.find((p) => p.name === col.property);
      // A file shows its picture when it is an image, its type otherwise.
      if (prop?.type === 'image' || prop?.type === 'file') continue;
      if (prop?.type !== 'ref' && prop?.type !== 'refs') {
        throw new Error(`${where} is a thumbnail; it must be an image or file property, or a ref or refs to an object with an image`);
      }
      const target = objectsByName.get(prop.target);
      if (target !== undefined && !target.properties.some((p) => p.type === 'image')) {
        throw new Error(`${where} is a thumbnail, but its target '${prop.target}' has no image property`);
      }
    }
  }
}

function checkColumnSums(obj: ObjectConfig): void {
  for (const list of obj.lists) {
    for (const col of list.columns) {
      const where = `list column '${obj.name}.${list.name}.${col.property}'`;
      if (col.sumWhen !== undefined && col.sumOf === undefined) throw new Error(`${where}: sumWhen needs sumOf`);
      if (col.sumOf === undefined) continue;
      const [arrayName, itemName] = col.sumOf.split('.');
      const array = obj.properties.find((p) => p.name === arrayName);
      const item = array?.type === 'array' ? array.item.properties.find((p) => p.name === itemName) : undefined;
      if (item?.type !== 'integer') throw new Error(`${where}: sumOf '${col.sumOf}' must name an array property and an integer property of its items`);
      if (col.sumWhen !== undefined && !obj.properties.some((p) => p.name === col.sumWhen?.property)) {
        throw new Error(`${where}: sumWhen names '${col.sumWhen.property}', which is not a property of '${obj.name}'`);
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
const UNIQUE_INCAPABLE_TYPES = new Set(['id', 'sequence', 'object', 'array', 'refs', 'image', 'file']);

function checkProperties(
  scope: string,
  properties: PropertyConfig[],
  knownObjects: Set<string>,
  hasLocales: boolean,
  nested = false,
): void {
  assertUnique(
    properties.map((p) => p.name),
    `property name in '${scope}'`,
  );
  for (const prop of properties) {
    if (!nested && (TIMESTAMP_FIELDS as readonly string[]).includes(prop.name)) {
      throw new Error(`property '${scope}.${prop.name}' is reserved: every record carries ${TIMESTAMP_FIELDS.join(' and ')} from the log (ADR 17)`);
    }
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
    if ((prop.type === 'text' || prop.type === 'markdown') && prop.translated === true) {
      checkTranslated(`${scope}.${prop.name}`, prop, hasLocales, nested);
    }
    if (prop.type === 'object') {
      checkProperties(`${scope}.${prop.name}`, prop.properties, knownObjects, hasLocales, true);
    }
    if (prop.type === 'array') {
      for (const key of [prop.uniqueBy ?? []].flat()) {
        if (!prop.item.properties.some((p) => p.name === key)) throw new Error(`array property '${scope}.${prop.name}' has uniqueBy '${key}', not one of its item properties`);
      }
    }
  }
}

function checkTranslated(path: string, prop: PropertyConfig, hasLocales: boolean, nested: boolean): void {
  if (!hasLocales) {
    throw new Error(`translated property '${path}' needs a top-level 'locales' list, e.g. "locales": ["en", "hu"]`);
  }
  if (nested) throw new Error(`translated property '${path}' is nested; only top-level properties can be translated`);
  if (prop.validation?.unique === true) throw new Error(`translated property '${path}' cannot be unique`);
  if (prop.default !== undefined) throw new Error(`translated property '${path}' cannot declare a default`);
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
    const files = obj.properties.filter(isAssetFileProperty);
    if (files.length === 0) {
      throw new Error(
        `'assets' object '${named}' has no image or file property; an asset object needs one to hold its file. See ${ASSETS_DOC}`,
      );
    }
    if (files.length > 1) {
      throw new Error(
        `'assets' object '${named}' has ${files.length} image or file properties ` +
          `(${files.map((p) => `'${p.name}'`).join(', ')}); it must have exactly one, so /assets/<id> knows which file to ` +
          `serve. See ${ASSETS_DOC}`,
      );
    }
    const holdsDocuments = files[0]?.type === 'file';
    for (const other of config.objects) {
      for (const prop of other.properties) {
        if (prop.type === 'markdown' && prop.documents === true && !holdsDocuments) {
          throw new Error(
            `property '${other.name}.${prop.name}' asks for document links, but the 'assets' object '${named}' holds ` +
              `its file in an image property, which takes images only; make it a file property. See ${ASSETS_DOC}`,
          );
        }
      }
    }
    return;
  }
  for (const obj of config.objects) {
    for (const prop of obj.properties) {
      if (prop.type === 'markdown' && (prop.images === true || prop.documents === true)) {
        throw new Error(
          `property '${obj.name}.${prop.name}' asks for in-body ${prop.images === true ? 'images' : 'document links'}, ` +
            `but no 'assets' object is named; define an asset object and set 'assets' to its name. See ${ASSETS_DOC}`,
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

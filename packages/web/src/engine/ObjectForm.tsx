import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  appConfig,
  viewFields,
  formatCell,
  displayText,
  imagePropertyOf,
  isTranslated,
  thumbnailHash,
  localeInputKey,
  singletonId,
  isoToLocalInput,
  isVisible,
  slugify,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewFieldSpec,
  type ViewMode,
} from '@sprintster/engine';
import { Button, parseRefIds, type SelectOption } from '../ui/index.js';
import { Field } from './Field.js';
import { assetUrl } from '../api/assets.js';
import { RepeatingGroup } from './RepeatingGroup.js';
import { initInputs, readPath, formatError, firstLabelField, type Row } from './resolve.js';
import styles from './ObjectPanel.module.css';

export interface RefData {
  options: SelectOption[];
  rawById: Map<string, Row>;
  // Set when the target searches on the server: asks for the matches of a query.
  search?: (query: string) => void;
  // The target carries a picture (its own image, or its list's thumbnail through a ref), so the field picks visually.
  visual: boolean;
}

// How a target record shows as a picture: its own image property, else the `#thumb` field of its list's thumbnail ref column.
function thumbnailSource(target: ObjectConfig | undefined, resolveObject: ObjectResolver): { fields: string[]; of: (r: Row) => string | undefined } | null {
  const url = (value: unknown) => {
    const hash = thumbnailHash(value);
    return hash === null ? undefined : assetUrl(hash);
  };
  const own = imagePropertyOf(target);
  if (own !== null) return { fields: [own], of: (r) => url(r[own]) };
  const column = target?.lists[0]?.columns.find((c) => c.thumbnail === true);
  const prop = column === undefined ? undefined : target?.properties.find((p) => p.name === column.property);
  if (prop?.type !== 'ref' && prop?.type !== 'refs') return null;
  if (imagePropertyOf(resolveObject(prop.target)) === null) return null;
  const key = `${prop.name}#thumb`;
  return { fields: [prop.name, key], of: (r) => url(r[key]) };
}

// ADR 24: a picker shows the server's matches, a page at a time.
const REF_PAGE = 50;

export interface ObjectFormState {
  viewName: string;
  specs: ViewFieldSpec[];
  inputs: Record<string, string>;
  setInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setField: (path: string, value: string) => void;
  refData: Record<string, RefData>;
  // Raw values of each field's placeholderFrom source, by field path.
  placeholderValues: Record<string, unknown>;
  // Choices for array columns that declare columnOptions: field path, then column.
  columnChoices: Record<string, Record<string, string[]>>;
  // Raw label sources by field path; `columns` holds them per array column.
  liveLabels: { fields: Record<string, unknown>; columns: Record<string, Record<string, unknown>> } | null;
  displayFor: (spec: ViewFieldSpec) => string;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  locale: string | undefined;
  setLocale: Dispatch<SetStateAction<string | undefined>>;
  // Called when the field at `path` loses focus: fills the empty fields that declare it as their fillFrom.
  fill: (path: string) => void;
}

export function useObjectForm(
  api: ApiClient,
  obj: ObjectConfig,
  resolveObject: ObjectResolver,
  mode: ViewMode,
  row: Row | null,
): ObjectFormState {
  const viewName = obj.views?.[0]?.name ?? 'default';
  const specs = useMemo(() => viewFields(obj, viewName, mode, resolveObject), [obj, viewName, mode, resolveObject]);
  const [inputs, setInputs] = useState<Record<string, string>>(() => initInputs(specs, mode, row));
  const [refData, setRefData] = useState<Record<string, RefData>>({});
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, unknown>>({});
  const [columnChoices, setColumnChoices] = useState<Record<string, Record<string, string[]>>>({});
  const [liveLabels, setLiveLabels] = useState<ObjectFormState['liveLabels']>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState<string | undefined>(appConfig.locales?.[0]);

  useEffect(() => {
    setInputs(initInputs(specs, mode, row));
    setError(null);
  }, [specs, mode, row]);

  useEffect(() => {
    let alive = true;
    // Every option a picker has shown, so a chosen record keeps its label when the matches change.
    const known = new Map<string, Map<string, SelectOption>>();
    const raw = new Map<string, Map<string, Row>>();
    async function load() {
      const next: Record<string, RefData> = {};
      for (const s of specs) {
        if ((s.property.type !== 'ref' && s.property.type !== 'refs') || s.derivedFromRef !== null) continue;
        const targetName = s.property.target;
        const target = resolveObject(targetName);
        const labelField = s.property.display ?? (target ? firstLabelField(target) : 'id');
        const thumb = thumbnailSource(target, resolveObject);
        const toOption = (r: Row): SelectOption => ({ value: String(r['id']), label: displayText(r[labelField]) || String(r['id']), thumb: thumb?.of(r) });
        const client = api.object<Row>(targetName);
        const seen = new Map<string, SelectOption>();
        const rawById = new Map<string, Row>();
        known.set(s.path, seen);
        raw.set(s.path, rawById);
        if (target?.lists[0]?.search === undefined) {
          const list = await client.list();
          for (const r of list) {
            seen.set(String(r['id']), toOption(r));
            rawById.set(String(r['id']), r);
          }
          next[s.path] = { options: [...seen.values()], rawById, visual: thumb !== null };
          continue;
        }
        const fields = [...new Set([labelField, ...(thumb?.fields ?? [])])];
        const value = row?.[s.path];
        const chosen = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v !== '');
        if (chosen.length > 0) {
          for (const r of (await client.page({ ids: chosen.slice(0, 100), limit: 100 })).rows) {
            seen.set(String(r['id']), toOption(r));
            rawById.set(String(r['id']), r);
          }
        }
        const first = await client.page({ fields, limit: REF_PAGE });
        const path = s.path;
        let asked = 0;
        const search = (query: string) => {
          const mine = ++asked;
          const q = query.trim();
          void client.page({ fields, limit: REF_PAGE, ...(q === '' ? {} : { q }) }).then((page) => {
            if (!alive || mine !== asked) return;
            const matches = page.rows.map(toOption);
            for (const o of matches) seen.set(o.value, o);
            setRefData((d) => {
              const current = d[path];
              if (current === undefined) return d;
              const chosenNow = [...seen.values()].filter((o) => !matches.some((m) => m.value === o.value));
              return { ...d, [path]: { ...current, options: [...matches, ...chosenNow] } };
            });
          });
        };
        for (const r of first.rows) seen.set(String(r['id']), toOption(r));
        next[s.path] = { options: [...seen.values()], rawById, visual: thumb !== null, search };
      }
      if (alive) setRefData(next);
    }
    load().catch((e) => {
      if (alive) setError(formatError(e));
    });
    return () => {
      alive = false;
    };
  }, [api, specs, resolveObject, row]);

  // A record picked from the server's matches carries only its label; fields shown from it need the whole record.
  useEffect(() => {
    for (const s of specs) {
      if (s.derivedFromRef === null) continue;
      const rd = refData[s.derivedFromRef];
      const id = inputs[s.derivedFromRef] ?? '';
      const ref = specs.find((x) => x.path === s.derivedFromRef);
      if (rd === undefined || id === '' || rd.rawById.has(id) || ref === undefined || (ref.property.type !== 'ref' && ref.property.type !== 'refs')) continue;
      void api
        .object<Row>(ref.property.target)
        .get(id)
        .then((r) => {
          if (r === null) return;
          rd.rawById.set(id, r);
          setRefData((d) => ({ ...d }));
        });
    }
  }, [api, specs, refData, inputs]);

  useEffect(() => {
    let alive = true;
    const sourced = specs.filter((s) => s.placeholderFrom !== null);
    if (sourced.length === 0) return;
    Promise.all(
      [...new Set(sourced.map((s) => s.placeholderFrom!.object))].map(async (name) => {
        const target = resolveObject(name);
        return [name, target === undefined ? null : await api.object<Row>(name).get(singletonId(target))] as const;
      }),
    )
      .then((records) => {
        if (!alive) return;
        const byObject = new Map(records);
        setPlaceholderValues(Object.fromEntries(sourced.map((s) => [s.path, byObject.get(s.placeholderFrom!.object)?.[s.placeholderFrom!.property]])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, specs, resolveObject]);

  useEffect(() => {
    let alive = true;
    const sourced = specs.filter((s) => s.columnOptions !== undefined);
    if (sourced.length === 0) return;
    const names = [...new Set(sourced.flatMap((s) => Object.values(s.columnOptions!).map((c) => c.object)))];
    Promise.all(
      names.map(async (name) => {
        const target = resolveObject(name);
        return [name, target === undefined ? null : await api.object<Row>(name).get(singletonId(target))] as const;
      }),
    )
      .then((records) => {
        if (!alive) return;
        const byObject = new Map(records);
        const choicesFor = (c: { object: string; array: string; column: string }) => {
          const rows = byObject.get(c.object)?.[c.array];
          return Array.isArray(rows) ? rows.map((r) => displayText((r as Row)[c.column])).filter((v) => v !== '') : [];
        };
        setColumnChoices(
          Object.fromEntries(sourced.map((s) => [s.path, Object.fromEntries(Object.entries(s.columnOptions!).map(([name, c]) => [name, choicesFor(c)]))])),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, specs, resolveObject]);

  useEffect(() => {
    let alive = true;
    const sourced = specs.filter((s) => s.labelFrom !== undefined || s.columnLabelsFrom !== undefined);
    if (sourced.length === 0) return;
    const names = [...new Set(sourced.flatMap((s) => [...(s.labelFrom === undefined ? [] : [s.labelFrom.object]), ...Object.values(s.columnLabelsFrom ?? {}).map((c) => c.object)]))];
    Promise.all(
      names.map(async (name) => {
        const target = resolveObject(name);
        return [name, target === undefined ? null : await api.object<Row>(name).get(singletonId(target))] as const;
      }),
    )
      .then((records) => {
        if (!alive) return;
        const byObject = new Map(records);
        const read = (c: { object: string; property: string }) => byObject.get(c.object)?.[c.property];
        setLiveLabels({
          fields: Object.fromEntries(sourced.flatMap((s) => (s.labelFrom === undefined ? [] : [[s.path, read(s.labelFrom)]]))),
          columns: Object.fromEntries(sourced.map((s) => [s.path, Object.fromEntries(Object.entries(s.columnLabelsFrom ?? {}).map(([k, c]) => [k, read(c)]))])),
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, specs, resolveObject]);

  function setField(path: string, value: string) {
    setInputs((prev) => ({ ...prev, [path]: value }));
  }

  function fill(path: string) {
    const source = specs.find((s) => s.path === path);
    const fallback = appConfig.locales?.[0];
    const text = source !== undefined && isTranslated(source.property) && fallback !== undefined ? inputs[localeInputKey(path, fallback)] : inputs[path];
    for (const target of specs.filter((s) => s.fillFrom === path && s.editable && (inputs[s.path] ?? '').trim() === '')) {
      const validation = target.property.type === 'text' ? target.property.validation : undefined;
      const max = validation?.maxLength;
      const value = (max === undefined ? slugify(text ?? '') : slugify(text ?? '').slice(0, max)).replace(/-+$/, '');
      if (value === '') continue;
      const ownId = typeof row?.['id'] === 'string' ? row['id'] : undefined;
      const free = validation?.unique === true ? api.object(obj.name).freeValue(target.path, value, ownId).catch(() => value) : Promise.resolve(value);
      void free.then((v) => setInputs((prev) => ((prev[target.path] ?? '').trim() === '' ? { ...prev, [target.path]: v } : prev)));
    }
  }

  function displayFor(spec: ViewFieldSpec): string {
    if (spec.derivedFromRef !== null) {
      const rd = refData[spec.derivedFromRef];
      const raw = rd?.rawById.get(inputs[spec.derivedFromRef] ?? '');
      const leaf = spec.path.slice(spec.path.lastIndexOf('.') + 1);
      return displayText(raw ? raw[leaf] : undefined, locale);
    }
    if (spec.property.type === 'ref') {
      const rd = refData[spec.path];
      return rd?.options.find((o) => o.value === inputs[spec.path])?.label ?? inputs[spec.path] ?? '';
    }
    if (spec.property.type === 'refs') {
      const rd = refData[spec.path];
      return parseRefIds(inputs[spec.path] ?? '', true)
        .map((id) => rd?.options.find((o) => o.value === id)?.label ?? id)
        .join(', ');
    }
    if (spec.property.type === 'array') {
      const arr = row !== null ? readPath(row, spec.path) : undefined;
      if (!Array.isArray(arr)) return '';
      return arr
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          const first = o['value'] ?? Object.values(o)[0];
          return first == null ? '' : String(first);
        })
        .filter(Boolean)
        .join(', ');
    }
    const raw = row !== null ? readPath(row, spec.path) : undefined;
    if (isTranslated(spec.property)) return displayText(raw, locale);
    return formatCell(spec.property, raw, '');
  }

  return { viewName, specs, inputs, setInputs, setField, refData, placeholderValues, columnChoices, liveLabels, displayFor, error, setError, busy, setBusy, locale, setLocale, fill };
}

function sections(specs: ViewFieldSpec[]): Array<{ title: string | null; specs: ViewFieldSpec[] }> {
  const out: Array<{ title: string | null; specs: ViewFieldSpec[] }> = [];
  for (const s of specs) {
    const last = out[out.length - 1];
    if (last !== undefined && last.title === s.group) last.specs.push(s);
    else out.push({ title: s.group, specs: [s] });
  }
  return out;
}

// One language at a time: the switch flips every translated field, and an empty one shows the default locale's text as its placeholder.
function LocaleSwitch({ locale, setLocale }: Pick<ObjectFormState, 'locale' | 'setLocale'>) {
  return (
    <div className={styles.locales} role="group" aria-label="Language">
      {(appConfig.locales ?? []).map((l) => (
        <Button key={l} variant={l === locale ? 'primary' : 'neutral'} aria-pressed={l === locale} onClick={() => setLocale(l)}>
          {l}
        </Button>
      ))}
    </div>
  );
}

function sourcedSpec(spec: ViewFieldSpec, values: Record<string, unknown>, locale: string | undefined): ViewFieldSpec {
  const text = displayText(values[spec.path], locale);
  return text === '' ? spec : { ...spec, placeholder: text };
}

function translatedSpec(spec: ViewFieldSpec, inputs: Record<string, string>, locale: string): ViewFieldSpec {
  const fallback = appConfig.locales?.[0];
  if (locale === fallback || fallback === undefined) return spec;
  return { ...spec, placeholder: inputs[localeInputKey(spec.path, fallback)] || spec.placeholder };
}

const COMPACT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso: unknown) => (typeof iso === 'string' && iso !== '' && !Number.isNaN(Date.parse(iso)) ? COMPACT.format(new Date(iso)) : null);

// The times every record carries from its events (ADR 17); nothing before its first save.
export function RecordTimes({ row }: { row: Row | null }) {
  const created = when(row?.['createdAt']);
  const updated = when(row?.['updatedAt']);
  if (created === null && updated === null) return null;
  return (
    <p className={styles.times}>
      {[created !== null ? `Created ${created}` : null, updated !== null ? `Updated ${updated}` : null].filter(Boolean).join(' · ')}
    </p>
  );
}

function hasTranslated(form: ObjectFormState): boolean {
  return form.locale !== undefined && form.specs.some((s) => s.derivedFromRef === null && isTranslated(s.property));
}

// The language switch on its own, for a host that places it outside the fields (a dialog header).
export function FormLocales({ form }: { form: ObjectFormState }) {
  if (!hasTranslated(form) || (appConfig.locales ?? []).length < 2) return null;
  return <LocaleSwitch locale={form.locale} setLocale={form.setLocale} />;
}

export function ObjectFields({ form, locales = true }: { form: ObjectFormState; locales?: boolean }) {
  const { specs, inputs, setInputs, setField, refData, placeholderValues, columnChoices, liveLabels, displayFor, locale, setLocale, fill } = form;
  const translated = locale !== undefined && hasTranslated(form);
  const fillSources = new Set(specs.flatMap((s) => (s.fillFrom === undefined ? [] : [s.fillFrom])));
  const filling = (path: string, field: ReactNode) =>
    fillSources.has(path) ? (
      <div key={path} className={styles.contents} onBlur={() => fill(path)}>
        {field}
      </div>
    ) : (
      field
    );
  return (
    <>
      {locales && translated && (appConfig.locales ?? []).length > 1 && <LocaleSwitch locale={locale} setLocale={setLocale} />}
      {sections(
        specs
          .filter((s) => isVisible(s, inputs))
          .flatMap((s) => {
            if (s.labelFrom === undefined) return [s];
            const label = displayText(liveLabels?.fields[s.path], locale);
            return label === '' ? [] : [{ ...s, label }];
          }),
      ).map((section, i) => (
        <div key={section.title ?? `s${i}`} className={section.title !== null ? styles.fieldset : undefined}>
          {section.title !== null && <div className={styles.legend}>{section.title}</div>}
          <div className={styles.fields}>
            {section.specs.map((spec) =>
              spec.property.type === 'array' ? (
                <RepeatingGroup
                  key={spec.path}
                  label={spec.label}
                  path={spec.path}
                  itemProperties={spec.property.item.properties}
                  inputs={inputs}
                  setInputs={setInputs}
                  layout={spec.layout}
                  readOnly={!spec.editable}
                  columnChoices={columnChoices[spec.path]}
                  columnLabels={spec.columnLabelsFrom === undefined ? undefined : Object.fromEntries(Object.keys(spec.columnLabelsFrom).map((k) => [k, displayText(liveLabels?.columns[spec.path]?.[k], locale)]))}
                  columnVisibleWhen={spec.columnVisibleWhen}
                />
              ) : translated && spec.derivedFromRef === null && isTranslated(spec.property) ? (
                filling(
                  spec.path,
                  <Field
                    key={localeInputKey(spec.path, locale)}
                    spec={translatedSpec(sourcedSpec(spec, placeholderValues, locale), inputs, locale)}
                    value={inputs[localeInputKey(spec.path, locale)] ?? ''}
                    onChange={(v) => setField(localeInputKey(spec.path, locale), v)}
                    display={displayFor(spec)}
                  />,
                )
              ) : (
                filling(
                  spec.path,
                  <Field
                    key={spec.path}
                    spec={sourcedSpec(spec, placeholderValues, locale)}
                    value={inputs[spec.path] ?? ''}
                    onChange={(v) => setField(spec.path, v)}
                    refOptions={refData[spec.path]?.options}
                    refSearch={refData[spec.path]?.search}
                    refVisual={refData[spec.path]?.visual === true}
                    refUpload={(spec.property.type === 'ref' || spec.property.type === 'refs') && spec.property.target === appConfig.assets}
                    display={displayFor(spec)}
                  />,
                )
              ),
            )}
          </div>
        </div>
      ))}
    </>
  );
}

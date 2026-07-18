import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { arrayItemCount, penceToPounds, toInput, type PropertyConfig, type ViewFieldSpec, type ViewMode } from '@sprintster/engine';
import { THEME } from '../theme.js';
import { wrapLines } from '../editor.js';
import { fuzzyFilter } from '@sprintster/engine';
import { pickerWindow } from '../picker-window.js';
import { MultilineInput } from './MultilineInput.js';
import { Picker, PickerOverlay, type PickerOption } from './Picker.js';
import { sanitizeFieldInput } from '../field-sanitize.js';

export type PopupFormValues = Record<string, string>;
export type RefOptionMap = Record<string, ReadonlyArray<PickerOption>>;

export interface PopupFormProps {
  title: string;
  fields: ViewFieldSpec[];
  fieldWidth?: number | undefined;
  initial?: PopupFormValues;
  refOptions?: RefOptionMap;
  errorMessage?: string | null;
  mode: ViewMode;
  onSubmit?: ((values: PopupFormValues) => void) | undefined;
  onCancel(): void;
}

const DEFAULT_FIELD_WIDTH = 60;
const BG = THEME.bgColor;
const FIELD_BG = THEME.fieldBgColor;

interface PanelSizing {
  panelWidth: number;
  innerWidth: number;
  labelCol: number;
  fieldWidth: number;
  groupFrameWidth: number;
  groupFieldWidth: number;
  overlayLeft: number;
}

function computeSizing(fields: ViewFieldSpec[], fieldWidthInput: number): PanelSizing {
  const longestLabel = fields.reduce((acc, f) => Math.max(acc, f.label.length), 0);
  const labelCol = longestLabel + 2;
  const fieldWidth = Math.max(1, fieldWidthInput);
  const innerWidth = labelCol + fieldWidth + 3;
  const panelWidth = innerWidth + 2;
  return {
    panelWidth,
    innerWidth,
    labelCol,
    fieldWidth,
    groupFrameWidth: innerWidth - 2,
    groupFieldWidth: Math.max(1, fieldWidth - 4),
    overlayLeft: 1 + 2 + labelCol,
  };
}

// text, code, and markdown all edit a raw string in the same multiline text editor.
const MULTILINE_TEXT_TYPES: ReadonlySet<PropertyConfig['type']> = new Set(['text', 'code', 'markdown']);
const isMultilineText = (type: PropertyConfig['type']): boolean => MULTILINE_TEXT_TYPES.has(type);

function controlHeight(field: ViewFieldSpec, value: string, width: number): number {
  if (isMultilineText(field.property.type) && field.editable) {
    return Math.max(field.rows, wrapLines(value, width).length);
  }
  return 1;
}

function arrayItemProps(field: ViewFieldSpec): PropertyConfig[] {
  return field.property.type === 'array' ? field.property.item.properties : [];
}

const TRASH = '\u{f1f8}';

function arrayBlockHeight(field: ViewFieldSpec, values: PopupFormValues): number {
  const n = arrayItemCount(field.path, values);
  const subCount = arrayItemProps(field).length;
  if (n === 0) return 2;
  const itemRows = 2 * subCount + 1; // padTop + fields + gaps + padBottom
  return 1 + n * itemRows + (n - 1) + 1; // top border + items + dividers + bottom border
}

function addArrayItem(values: PopupFormValues, field: ViewFieldSpec): PopupFormValues {
  const n = arrayItemCount(field.path, values);
  const next = { ...values };
  for (const sub of arrayItemProps(field)) {
    next[`${field.path}.${n}.${sub.name}`] = sub.default !== undefined ? toInput(sub, sub.default) : '';
  }
  return next;
}

function removeArrayItem(values: PopupFormValues, field: ViewFieldSpec, idx: number): PopupFormValues {
  const n = arrayItemCount(field.path, values);
  const subs = arrayItemProps(field);
  const next = { ...values };
  for (const sub of subs) delete next[`${field.path}.${idx}.${sub.name}`];
  for (let j = idx + 1; j < n; j++) {
    for (const sub of subs) {
      const from = `${field.path}.${j}.${sub.name}`;
      next[`${field.path}.${j - 1}.${sub.name}`] = next[from] ?? '';
      delete next[from];
    }
  }
  return next;
}

function buildFormOrder(fields: ViewFieldSpec[], values: PopupFormValues): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f.editable) continue;
    if (f.property.type === 'array') {
      const n = arrayItemCount(f.path, values);
      for (let i = 0; i < n; i++) {
        for (const sub of f.property.item.properties) out.push(`${f.path}.${i}.${sub.name}`);
        out.push(`${f.path}.${i}.#remove`);
      }
      out.push(`${f.path}.#add`);
    } else {
      out.push(f.path);
    }
  }
  out.push('save', 'cancel');
  return out;
}

function pickerOptionsFor(field: ViewFieldSpec, refOptions: RefOptionMap): ReadonlyArray<PickerOption> | null {
  if (field.property.type === 'enum') {
    return field.property.values.map((v) => ({ id: v, label: v }));
  }
  if (field.property.type === 'ref') {
    return refOptions[field.path] ?? [];
  }
  return null;
}

function groupHeight(fields: ViewFieldSpec[], values: PopupFormValues, groupFieldWidth: number): number {
  let inner = 2;
  fields.forEach((f, idx) => {
    if (idx > 0) inner += 1;
    inner += controlHeight(f, values[f.path] ?? '', groupFieldWidth);
  });
  return inner + 2;
}

function currencySymbol(currency: string): string {
  if (currency === 'GBP') return '£';
  if (currency === 'USD') return '$';
  if (currency === 'EUR') return '€';
  return `${currency} `;
}

function formatReadOnly(field: ViewFieldSpec, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'N/A';
  const { property } = field;
  switch (property.type) {
    case 'money':
      return `${currencySymbol(property.currency)}${penceToPounds(String(raw))}`;
    case 'boolean':
      return raw === true ? 'yes' : 'no';
    default:
      return String(raw);
  }
}

function derivedValue(field: ViewFieldSpec, values: PopupFormValues, refOptions: RefOptionMap): unknown {
  if (field.derivedFromRef === null) return undefined;
  const localId = values[field.derivedFromRef];
  if (localId === undefined || localId === '') return null;
  const opts = refOptions[field.derivedFromRef] ?? [];
  const hit = opts.find((o) => o.id === localId);
  if (hit?.raw === undefined) return null;
  const segments = field.path.split('.');
  const leafName = segments[segments.length - 1];
  if (leafName === undefined) return null;
  return (hit.raw as Record<string, unknown>)[leafName];
}

function makeFill(innerWidth: number): (s: string) => string {
  return (s) => {
    if (s.length >= innerWidth) return s.slice(0, innerWidth);
    return s + ' '.repeat(innerWidth - s.length);
  };
}

const HELP_VIEW = 'Esc · Enter · v   close';
const HELP_EDIT = 'Alt+S save · Alt+C cancel · Tab next · Esc back';

export function PopupForm({
  title,
  fields,
  fieldWidth: fieldWidthProp = DEFAULT_FIELD_WIDTH,
  initial = {},
  refOptions = {},
  errorMessage,
  mode,
  onSubmit,
  onCancel,
}: PopupFormProps): React.JSX.Element {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 26;
  const sizing = useMemo(() => computeSizing(fields, fieldWidthProp), [fields, fieldWidthProp]);
  const fill = useMemo(() => makeFill(sizing.innerWidth), [sizing.innerWidth]);

  const [values, setValues] = useState<PopupFormValues>(() => {
    const initialValues: PopupFormValues = { ...initial };
    for (const field of fields) {
      if (field.property.type !== 'array' && initialValues[field.path] === undefined) initialValues[field.path] = '';
    }
    return initialValues;
  });

  const order = useMemo(() => (mode === 'view' ? [] : buildFormOrder(fields, values)), [fields, values, mode]);
  const [active, setActive] = useState<string>(order[0] ?? 'cancel');
  const [filter, setFilter] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    setFilter('');
  }, [active]);

  function setField(path: string, value: string): void {
    setValues((prev) => ({ ...prev, [path]: value }));
  }

  useInput((input, key) => {
    if (mode === 'view') {
      if (key.escape || key.return || input === 'v' || input === 'q') onCancel();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.meta && input === 's') {
      onSubmit?.(values);
      return;
    }
    if (key.meta && input === 'c') {
      onCancel();
      return;
    }
    if (key.tab) {
      const idx = order.indexOf(active);
      const delta = key.shift ? -1 : 1;
      const next = order[(idx + delta + order.length) % order.length];
      if (next !== undefined) setActive(next);
      return;
    }
    if (key.return) {
      if (active === 'save') {
        onSubmit?.(values);
        return;
      }
      if (active === 'cancel') {
        onCancel();
        return;
      }
      const addMatch = /^(.+)\.#add$/.exec(active);
      if (addMatch !== null) {
        const path = addMatch[1]!;
        const field = fields.find((f) => f.path === path);
        if (field !== undefined && field.property.type === 'array') {
          const n = arrayItemCount(path, values);
          setValues((v) => addArrayItem(v, field));
          const firstSub = field.property.item.properties[0]?.name;
          if (firstSub !== undefined) setActive(`${path}.${n}.${firstSub}`);
        }
        return;
      }
      const remMatch = /^(.+)\.(\d+)\.#remove$/.exec(active);
      if (remMatch !== null) {
        const path = remMatch[1]!;
        const idx = Number(remMatch[2]);
        const field = fields.find((f) => f.path === path);
        if (field !== undefined) {
          setValues((v) => removeArrayItem(v, field, idx));
          setActive(`${path}.#add`);
        }
        return;
      }
    }
  });

  const hasError = errorMessage !== null && errorMessage !== undefined && errorMessage !== '';
  const bottomLegendText = hasError ? errorMessage : mode === 'view' ? HELP_VIEW : HELP_EDIT;
  const bottomLegendColor = hasError ? THEME.errorColor : THEME.mutedColor;

  interface Block { key: string; node: React.ReactNode; height: number; active: boolean; topRow: number }
  const blockList: Block[] = [];
  const stopOffset: Record<string, { top: number; height: number }> = {};
  const recordStop = (stop: string, panelRow: number, height: number): void => {
    stopOffset[stop] = { top: panelRow - 1, height };
  };
  let row = 2;
  let dropdown: { top: number; selectedIndex: number; marginLeft: number; width: number; node: React.ReactNode } | null = null;
  const startBlock = (): number => {
    if (blockList.length > 0) row += 1; // inter-block gap (rendered as a leading blank row)
    return row;
  };
  for (let i = 0; i < fields.length; ) {
    const field = fields[i];
    if (field === undefined) break;
    if (field.group !== null) {
      const group = field.group;
      const groupFields: ViewFieldSpec[] = [];
      while (i < fields.length && fields[i]?.group === group) {
        const gf = fields[i];
        if (gf !== undefined) groupFields.push(gf);
        i += 1;
      }
      const groupStartRow = startBlock();
      let intra = 2;
      for (let j = 0; j < groupFields.length; j += 1) {
        const gf = groupFields[j];
        if (gf === undefined) continue;
        if (j > 0) intra += 1;
        recordStop(gf.path, groupStartRow + intra, controlHeight(gf, values[gf.path] ?? '', sizing.groupFieldWidth));
        if (gf.path === active) {
          const pickerOpts = gf.editable ? pickerOptionsFor(gf, refOptions) : null;
          if (pickerOpts !== null && pickerOpts.length > 0) {
            const val = values[gf.path] ?? '';
            const hits = fuzzyFilter(pickerOpts, filter);
            if (hits.length > 0) {
              const sel = Math.max(0, hits.findIndex((h) => h.option.id === val));
              const w = pickerWindow(hits.length, sel);
              dropdown = {
                top: groupStartRow + intra,
                selectedIndex: w.windowSel,
                marginLeft: sizing.overlayLeft + 1,
                width: sizing.groupFieldWidth + 2,
                node: (
                  <PickerOverlay
                    options={w.indices.map((k) => ({
                      id: hits[k]!.option.id,
                      label: hits[k]!.option.label,
                      matches: hits[k]!.matches,
                    }))}
                    selectedId={val}
                    width={sizing.groupFieldWidth}
                  />
                ),
              };
            }
          }
        }
        intra += controlHeight(gf, values[gf.path] ?? '', sizing.groupFieldWidth);
      }
      const groupActive = groupFields.some((gf) => gf.path === active);
      blockList.push({
        key: `group-${group}`,
        active: groupActive,
        topRow: groupStartRow,
        height: groupHeight(groupFields, values, sizing.groupFieldWidth),
        node: (
          <GroupBox
            key={`group-${group}`}
            title={group}
            fields={groupFields}
            values={values}
            active={active}
            setField={setField}
            refOptions={refOptions}
            labelCol={sizing.labelCol}
            groupFrameWidth={sizing.groupFrameWidth}
            groupFieldWidth={sizing.groupFieldWidth}
            filter={filter}
            setFilter={setFilter}
          />
        ),
      });
      row += groupHeight(groupFields, values, sizing.groupFieldWidth);
    } else if (field.property.type === 'array' && field.editable) {
      const top = startBlock();
      blockList.push({
        key: field.path,
        active: active.startsWith(`${field.path}.`),
        topRow: top,
        height: arrayBlockHeight(field, values),
        node: (
          <ArrayField
            key={field.path}
            field={field}
            values={values}
            active={active}
            setField={setField}
            labelCol={sizing.labelCol}
            groupFrameWidth={sizing.groupFrameWidth}
            groupFieldWidth={sizing.groupFieldWidth}
          />
        ),
      });
      if (field.property.type === 'array') {
        const subProps = field.property.item.properties;
        const nItems = arrayItemCount(field.path, values);
        let c = top + 1; // after the array's top border
        for (let it = 0; it < nItems; it += 1) {
          c += 1; // padTop
          subProps.forEach((sub, j) => {
            recordStop(`${field.path}.${it}.${sub.name}`, c, 1);
            c += 1;
            if (j < subProps.length - 1) c += 1; // gap
          });
          c += 1; // padBot
          if (it < nItems - 1) {
            recordStop(`${field.path}.${it}.#remove`, c, 1);
            c += 1; // divider carrying this item's Del pill
          }
        }
        recordStop(`${field.path}.#add`, c, 1); // bottom border
        if (nItems > 0) recordStop(`${field.path}.${nItems - 1}.#remove`, c, 1);
      }
      row += arrayBlockHeight(field, values);
      i += 1;
      continue;
    } else {
      const fieldTop = startBlock();
      recordStop(field.path, fieldTop, controlHeight(field, values[field.path] ?? '', sizing.fieldWidth));
      const pickerOpts = field.editable ? pickerOptionsFor(field, refOptions) : null;
      if (active === field.path && pickerOpts !== null && pickerOpts.length > 0) {
        const val = values[field.path] ?? '';
        const hits = fuzzyFilter(pickerOpts, filter);
        if (hits.length > 0) {
          const sel = Math.max(0, hits.findIndex((h) => h.option.id === val));
          const w = pickerWindow(hits.length, sel);
          dropdown = {
            top: fieldTop,
            selectedIndex: w.windowSel,
            marginLeft: sizing.overlayLeft - 1,
            width: sizing.fieldWidth + 2,
            node: (
              <PickerOverlay
                options={w.indices.map((i) => ({
                  id: hits[i]!.option.id,
                  label: hits[i]!.option.label,
                  matches: hits[i]!.matches,
                }))}
                selectedId={val}
                width={sizing.fieldWidth}
              />
            ),
          };
        }
      }
      blockList.push({
        key: field.path,
        active: active === field.path,
        topRow: fieldTop,
        height: controlHeight(field, values[field.path] ?? '', sizing.fieldWidth),
        node: (
          <FieldRow
            key={field.path}
            field={field}
            fieldWidth={sizing.fieldWidth}
            labelCol={sizing.labelCol}
            value={values[field.path] ?? ''}
            setValue={(v) => setField(field.path, v)}
            active={active === field.path}
            options={pickerOpts ?? undefined}
            filter={filter}
            setFilter={setFilter}
            refOptions={refOptions}
            allValues={values}
          />
        ),
      });
      row += controlHeight(field, values[field.path] ?? '', sizing.fieldWidth);
      i += 1;
    }
  }

  if (mode !== 'view') {
    recordStop('save', row + 1, 1);
    recordStop('cancel', row + 1, 1);
    blockList.push({
      key: 'buttons',
      active: active === 'save' || active === 'cancel',
      topRow: row + 1,
      height: 2,
      node: (
        <React.Fragment key="buttons">
          <ButtonRow saveActive={active === 'save'} cancelActive={active === 'cancel'} innerWidth={sizing.innerWidth} />
          <Text backgroundColor={BG}>{fill('')}</Text>
        </React.Fragment>
      ),
    });
  }

  const maxInner = Math.max(1, rows - 6);
  const totalInner = blockList.reduce((acc, b) => acc + 1 + b.height, 0);
  const needScroll = totalInner > maxInner;
  const viewportH = needScroll ? maxInner : totalInner;
  const activeBlock = blockList[Math.max(0, blockList.findIndex((b) => b.active))];
  const activeStop = stopOffset[active] ?? {
    top: (activeBlock?.topRow ?? 2) - 1,
    height: activeBlock?.height ?? 1,
  };
  const maxScroll = Math.max(0, totalInner - viewportH);
  const margin = Math.floor(viewportH / 4); // keep focus within the middle 50%

  let st = Math.min(scrollTop, maxScroll);
  if (needScroll) {
    if (activeStop.top < st + margin) {
      st = activeStop.top - margin;
    } else if (activeStop.top + activeStop.height > st + viewportH - margin) {
      st = activeStop.top + activeStop.height - viewportH + margin;
    }
    st = Math.max(0, Math.min(st, maxScroll));
  } else {
    st = 0;
  }

  useEffect(() => {
    if (st !== scrollTop) setScrollTop(st);
  }, [st, scrollTop]);

  const hasAbove = st > 0;
  const hasBelow = st + viewportH < totalInner;
  const innerRows: React.ReactNode[] = [];
  for (const b of blockList) {
    innerRows.push(<Text key={`lead-${b.key}`} backgroundColor={BG}>{fill('')}</Text>);
    innerRows.push(b.node);
  }

  const titleSuffix = hasAbove ? ' ↑' : '';
  const legendSuffix = hasBelow ? ' ↓' : '';

  return (
    <Box position="absolute" width={cols} height={rows} alignItems="center" justifyContent="center">
      <Box position="relative" flexDirection="column" width={sizing.panelWidth}>
        <Box flexDirection="column" borderStyle="round" borderColor={THEME.textColor} width={sizing.panelWidth}>
          <Box height={viewportH} flexDirection="column" overflowY="hidden">
            <Box flexDirection="column" flexShrink={0} width={sizing.innerWidth} marginTop={-st} backgroundColor={BG}>
              {innerRows}
            </Box>
          </Box>
        </Box>

        <Box position="absolute" marginLeft={2} width={sizing.panelWidth - 4}>
          <Text color={THEME.textColor}>
            ─ <Text color={THEME.accentColor} bold>{title}</Text> ─{titleSuffix}
          </Text>
        </Box>

        <Box position="absolute" bottom={0} marginLeft={2} width={sizing.panelWidth - 4}>
          <Text color={bottomLegendColor} wrap="truncate-end">
            {' '}{bottomLegendText}{legendSuffix}{' '}
          </Text>
        </Box>

        {dropdown !== null ? (
          <Box
            position="absolute"
            marginTop={dropdown.top - dropdown.selectedIndex - 1 - st}
            marginLeft={dropdown.marginLeft}
            width={dropdown.width}
            flexDirection="column"
            borderStyle="round"
            borderColor={THEME.accentColor}
          >
            {dropdown.node}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

interface FieldRowProps {
  field: ViewFieldSpec;
  fieldWidth: number;
  labelCol: number;
  value: string;
  setValue: (v: string) => void;
  active: boolean;
  options?: ReadonlyArray<PickerOption> | undefined;
  filter?: string | undefined;
  setFilter?: ((next: string) => void) | undefined;
  refOptions: RefOptionMap;
  allValues: PopupFormValues;
}

function FieldRow({ field, fieldWidth, labelCol, value, setValue, active, options, filter, setFilter, refOptions, allValues }: FieldRowProps): React.JSX.Element {
  const labelPart = `  ${(field.label + ':').padEnd(labelCol, ' ')}`;
  const labelColor = !field.editable ? THEME.mutedColor : active ? THEME.highlightColor : THEME.textColor;
  return (
    <Box alignItems="flex-start" paddingRight={1}>
      <Box flexShrink={0}>
        <Text backgroundColor={BG} color={labelColor}>{labelPart}</Text>
      </Box>
      <Box flexGrow={1}>
        <FieldControl field={field} fieldWidth={fieldWidth} labelCol={labelCol} value={value} setValue={setValue} active={active} options={options} filter={filter} setFilter={setFilter} refOptions={refOptions} allValues={allValues} />
      </Box>
    </Box>
  );
}

function FieldControl({ field, fieldWidth, value, setValue, active, options, filter, setFilter, refOptions, allValues }: FieldRowProps): React.JSX.Element {
  if (!field.editable) {
    const rawValue = field.derivedFromRef !== null ? derivedValue(field, allValues, refOptions) : value;
    const display = formatReadOnly(field, rawValue);
    const truncated = display.length > fieldWidth ? display.slice(0, fieldWidth - 1) + '…' : display;
    return <Text backgroundColor={BG} color={THEME.textColor}>{truncated}</Text>;
  }
  const property = field.property;
  if (property.type === 'enum' || property.type === 'ref') {
    const opts = options ?? (property.type === 'enum' ? property.values.map((v) => ({ id: v, label: v })) : []);
    return (
      <Picker
        value={value}
        onChange={setValue}
        focus={active}
        options={opts}
        width={fieldWidth}
        placeholder={field.placeholder}
        filter={filter}
        onFilterChange={setFilter}
      />
    );
  }
  if (isMultilineText(property.type)) {
    return (
      <MultilineInput
        value={value}
        onChange={setValue}
        focus={active}
        width={fieldWidth}
        minRows={field.rows}
        placeholder={field.placeholder}
      />
    );
  }
  const display = value.length >= fieldWidth ? value : value.padEnd(fieldWidth);
  if (!active) {
    return <Text backgroundColor={FIELD_BG} color={THEME.fieldTextColor}>{display}</Text>;
  }
  const shownLength = value.length > 0 ? value.length : field.placeholder.length;
  const filler = ' '.repeat(Math.max(0, fieldWidth - shownLength - 1));
  return (
    <Text backgroundColor={FIELD_BG} color={THEME.fieldTextColor}>
      <TextInput value={value} onChange={(v) => setValue(sanitizeFieldInput(property.type, v))} focus={true} placeholder={field.placeholder} />
      {filler}
    </Text>
  );
}

interface GroupBoxProps {
  title: string;
  fields: ViewFieldSpec[];
  values: PopupFormValues;
  active: string;
  setField: (path: string, value: string) => void;
  refOptions: RefOptionMap;
  labelCol: number;
  groupFrameWidth: number;
  groupFieldWidth: number;
  filter: string;
  setFilter: (next: string) => void;
}

function GroupBox({ title, fields, values, active, setField, refOptions, labelCol, groupFrameWidth, groupFieldWidth, filter, setFilter }: GroupBoxProps): React.JSX.Element {
  const rows: React.ReactNode[] = [];
  rows.push(<Text key="pad-top" backgroundColor={BG}>{' '}</Text>);
  fields.forEach((field, idx) => {
    if (idx > 0) rows.push(<Text key={`gap-${field.path}`} backgroundColor={BG}>{' '}</Text>);
    const pickerOpts = field.editable ? pickerOptionsFor(field, refOptions) : null;
    rows.push(
      <FieldRow
        key={field.path}
        field={field}
        fieldWidth={groupFieldWidth}
        labelCol={labelCol}
        value={values[field.path] ?? ''}
        setValue={(v) => setField(field.path, v)}
        active={active === field.path}
        options={pickerOpts ?? undefined}
        filter={filter}
        setFilter={setFilter}
        refOptions={refOptions}
        allValues={values}
      />,
    );
  });
  rows.push(<Text key="pad-bot" backgroundColor={BG}>{' '}</Text>);
  return (
    <Box position="relative" flexDirection="column" width={groupFrameWidth} marginLeft={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={THEME.mutedColor} width={groupFrameWidth}>
        {rows}
      </Box>
      <Box position="absolute" marginLeft={2} width={groupFrameWidth - 4}>
        <Text color={THEME.mutedColor}>─ <Text color={THEME.textColor}>{title}</Text> ─</Text>
      </Box>
    </Box>
  );
}

interface ArrayFieldProps {
  field: ViewFieldSpec;
  values: PopupFormValues;
  active: string;
  setField: (path: string, value: string) => void;
  labelCol: number;
  groupFrameWidth: number;
  groupFieldWidth: number;
}

const DEL_PILL = { leading: ` ${TRASH} `, head: 'D', rest: 'el ' };
const ADD_PILL = { leading: ' + ', head: 'A', rest: 'dd ' };
const PILL_CELLS = 9;

function BorderPill({ leading, head, rest, active }: { leading: string; head: string; rest: string; active: boolean }): React.JSX.Element {
  const fill = active ? THEME.buttonActiveBgColor : THEME.buttonBgColor;
  const labelColor = active ? THEME.buttonActiveTextColor : THEME.buttonTextColor;
  return (
    <Box flexDirection="row">
      <Box width={1}><Text color={fill}>{CAP_LEFT}</Text></Box>
      <Text backgroundColor={fill} color={labelColor} bold={active}>
        {leading}
        <Text color={THEME.highlightColor} underline>{head}</Text>
        {rest}
      </Text>
      <Box width={1}><Text color={fill}>{CAP_RIGHT}</Text></Box>
    </Box>
  );
}

function ArrayField({ field, values, active, setField, groupFrameWidth }: ArrayFieldProps): React.JSX.Element {
  const W = groupFrameWidth;
  const subs = field.property.type === 'array' ? field.property.item.properties : [];
  const n = arrayItemCount(field.path, values);
  const subLabelCol = subs.reduce((acc, s) => Math.max(acc, (s.title ?? s.name).length), 0) + 2;
  const itemFieldWidth = Math.max(1, W - 5 - subLabelCol);
  const muted = THEME.mutedColor;
  const dashes = (k: number): string => '─'.repeat(Math.max(0, k));
  const blankRow = (key: string): React.ReactNode => (
    <Box key={key} flexDirection="row" width={W}>
      <Text color={muted} backgroundColor={BG}>│</Text>
      <Text backgroundColor={BG}>{' '.repeat(Math.max(0, W - 2))}</Text>
      <Text color={muted} backgroundColor={BG}>│</Text>
    </Box>
  );

  const rows: React.ReactNode[] = [];

  const topDash = W - 5 - field.label.length;
  rows.push(
    <Text key="top" color={muted} backgroundColor={BG}>
      {'╭─ '}<Text color={THEME.textColor}>{field.label}</Text>{` ${dashes(topDash)}╮`}
    </Text>,
  );

  for (let i = 0; i < n; i += 1) {
    rows.push(blankRow(`pt-${i}`));
    subs.forEach((sub, j) => {
      if (j > 0) rows.push(blankRow(`gap-${i}-${j}`));
      const path = `${field.path}.${i}.${sub.name}`;
      const spec: ViewFieldSpec = {
        path,
        property: sub,
        label: sub.title ?? sub.name,
        placeholder: '',
        rows: 1,
        group: field.path,
        editable: true,
        derivedFromRef: null,
        defaultInput: '',
      };
      rows.push(
        <Box key={path} flexDirection="row" width={W}>
          <Text color={muted} backgroundColor={BG}>│</Text>
          <Box width={W - 2}>
            <FieldRow
              field={spec}
              fieldWidth={itemFieldWidth}
              labelCol={subLabelCol}
              value={values[path] ?? ''}
              setValue={(v) => setField(path, v)}
              active={active === path}
              refOptions={{}}
              allValues={values}
            />
          </Box>
          <Text color={muted} backgroundColor={BG}>│</Text>
        </Box>,
      );
    });
    rows.push(blankRow(`pb-${i}`));
    if (i < n - 1) {
      const delActive = active === `${field.path}.${i}.#remove`;
      rows.push(
        <Box key={`div-${i}`} flexDirection="row" width={W}>
          <Text color={muted} backgroundColor={BG}>{`├${dashes(W - 3 - PILL_CELLS)}`}</Text>
          <BorderPill {...DEL_PILL} active={delActive} />
          <Text color={muted} backgroundColor={BG}>─┤</Text>
        </Box>,
      );
    }
  }

  const addActive = active === `${field.path}.#add`;
  const lastDelActive = n > 0 && active === `${field.path}.${n - 1}.#remove`;
  const bottomMid = W - 4 - PILL_CELLS - (n > 0 ? PILL_CELLS : 0);
  rows.push(
    <Box key="bot" flexDirection="row" width={W}>
      <Text color={muted} backgroundColor={BG}>╰─</Text>
      <BorderPill {...ADD_PILL} active={addActive} />
      <Text color={muted} backgroundColor={BG}>{dashes(bottomMid)}</Text>
      {n > 0 ? <BorderPill {...DEL_PILL} active={lastDelActive} /> : null}
      <Text color={muted} backgroundColor={BG}>─╯</Text>
    </Box>,
  );

  return (
    <Box flexDirection="column" width={W} marginLeft={1}>
      {rows}
    </Box>
  );
}

interface ButtonRowProps {
  saveActive: boolean;
  cancelActive: boolean;
  innerWidth: number;
}

const BUTTON_WIDTH = 10;
const BUTTON_GAP = 4;

function centredPads(label: string, width: number): { left: string; right: string } {
  const padTotal = Math.max(0, width - label.length);
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;
  return { left: ' '.repeat(padLeft), right: ' '.repeat(padRight) };
}

const CAP_LEFT = '\u{E0B6}';
const CAP_RIGHT = '\u{E0B4}';

function Button({ label, active }: { label: string; active: boolean }): React.JSX.Element {
  const head = label.slice(0, 1);
  const rest = label.slice(1);
  const fill = active ? THEME.buttonActiveBgColor : THEME.buttonBgColor;
  const labelColor = active ? THEME.buttonActiveTextColor : THEME.buttonTextColor;
  const pads = centredPads(label, BUTTON_WIDTH - 2);
  return (
    <Text>
      <Text color={fill}>{CAP_LEFT}</Text>
      <Text backgroundColor={fill} color={labelColor} bold={active}>
        {pads.left}
        <Text color={THEME.highlightColor} underline>{head}</Text>
        {rest}
        {pads.right}
      </Text>
      <Text color={fill}>{CAP_RIGHT}</Text>
    </Text>
  );
}

function ButtonRow({ saveActive, cancelActive, innerWidth }: ButtonRowProps): React.JSX.Element {
  const totalRowWidth = BUTTON_WIDTH * 2 + BUTTON_GAP;
  const sidePad = Math.max(0, Math.floor((innerWidth - totalRowWidth) / 2));
  const trailPad = Math.max(0, innerWidth - sidePad - totalRowWidth);

  return (
    <Text backgroundColor={BG}>
      {' '.repeat(sidePad)}
      <Button label="Save" active={saveActive} />
      {' '.repeat(BUTTON_GAP)}
      <Button label="Cancel" active={cancelActive} />
      {' '.repeat(trailPad)}
    </Text>
  );
}

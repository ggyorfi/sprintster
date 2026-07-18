import { z } from 'zod';

export const Editability = z.enum(['always', 'onCreate', 'never']);
export type Editability = z.infer<typeof Editability>;

export const ValidationRules = z
  .object({
    required: z.boolean().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    format: z.enum(['email']).optional(),
    unique: z.boolean().optional(),
  })
  .strict();
export type ValidationRules = z.infer<typeof ValidationRules>;

interface PropertyBase {
  name: string;
  title?: string | undefined;
  nullable?: boolean | undefined;
  system?: boolean | undefined;
  editable?: Editability | undefined;
  default?: unknown;
  validation?: ValidationRules | undefined;
}

export type PropertyConfig =
  | (PropertyBase & { type: 'id'; strategy: 'uuid' | 'sequence' })
  | (PropertyBase & { type: 'text' })
  | (PropertyBase & { type: 'enum'; values: string[] })
  | (PropertyBase & { type: 'money'; currency: string })
  | (PropertyBase & { type: 'integer' })
  | (PropertyBase & { type: 'date' })
  | (PropertyBase & { type: 'datetime' })
  | (PropertyBase & { type: 'ref'; target: string; display?: string | undefined })
  | (PropertyBase & { type: 'boolean' })
  | (PropertyBase & { type: 'sequence' })
  | (PropertyBase & { type: 'object'; properties: PropertyConfig[] })
  | (PropertyBase & { type: 'array'; item: { properties: PropertyConfig[] } });

const baseProperty = {
  name: z.string().min(1),
  title: z.string().optional(),
  nullable: z.boolean().optional(),
  system: z.boolean().optional(),
  editable: Editability.optional(),
  default: z.unknown().optional(),
  validation: ValidationRules.optional(),
};

const IdProperty = z.object({ ...baseProperty, type: z.literal('id'), strategy: z.enum(['uuid', 'sequence']) }).strict();
const TextProperty = z.object({ ...baseProperty, type: z.literal('text') }).strict();
const EnumProperty = z.object({ ...baseProperty, type: z.literal('enum'), values: z.array(z.string()).min(1) }).strict();
const MoneyProperty = z.object({ ...baseProperty, type: z.literal('money'), currency: z.string().min(1) }).strict();
const IntegerProperty = z.object({ ...baseProperty, type: z.literal('integer') }).strict();
const DateProperty = z.object({ ...baseProperty, type: z.literal('date') }).strict();
const DatetimeProperty = z.object({ ...baseProperty, type: z.literal('datetime') }).strict();
const RefProperty = z
  .object({ ...baseProperty, type: z.literal('ref'), target: z.string().min(1), display: z.string().min(1).optional() })
  .strict();
const BooleanProperty = z.object({ ...baseProperty, type: z.literal('boolean') }).strict();
const SequenceProperty = z.object({ ...baseProperty, type: z.literal('sequence') }).strict();
const ObjectProperty = z
  .object({ ...baseProperty, type: z.literal('object'), properties: z.array(z.lazy(() => PropertyConfigSchema)) })
  .strict();
const ArrayProperty = z
  .object({
    ...baseProperty,
    type: z.literal('array'),
    item: z.object({ properties: z.array(z.lazy(() => PropertyConfigSchema)).min(1) }).strict(),
  })
  .strict();

export const PropertyConfigSchema: z.ZodType<PropertyConfig> = z.lazy(() =>
  z.discriminatedUnion('type', [
    IdProperty,
    TextProperty,
    EnumProperty,
    MoneyProperty,
    IntegerProperty,
    DateProperty,
    DatetimeProperty,
    RefProperty,
    BooleanProperty,
    SequenceProperty,
    ObjectProperty,
    ArrayProperty,
  ]),
);

export const Lifecycle = z.union([
  z.object({ softDelete: z.string().min(1) }).strict(),
  z.object({ statusField: z.string().min(1) }).strict(),
]);
export type Lifecycle = z.infer<typeof Lifecycle>;

export const ColumnConfig = z
  .object({
    property: z.string().min(1),
    label: z.string().optional(),
    width: z.number().int().positive().optional(),
    suffix: z.string().optional(),
  })
  .strict();

export const SearchConfig = z
  .object({ fields: z.array(z.string().min(1)).min(1), idPrefix: z.boolean().optional() })
  .strict();

export const FilterConfig = z.object({ property: z.string().min(1) }).strict();

export const ListActionConfig = z
  .object({
    hotkey: z.string().length(1),
    label: z.string().min(1),
    kind: z.enum(['create', 'edit', 'view', 'delete']),
    view: z.string().min(1).optional(),
    confirm: z.string().min(1).optional(),
  })
  .strict();
export type ListActionConfig = z.infer<typeof ListActionConfig>;

export const ListConfig = z
  .object({
    name: z.string().min(1),
    title: z.string(),
    columns: z.array(ColumnConfig).min(1),
    search: SearchConfig.optional(),
    filters: z.array(FilterConfig).optional(),
    actions: z.array(ListActionConfig).optional(),
  })
  .strict();
export type ListConfig = z.infer<typeof ListConfig>;

export const ViewFieldConfig = z
  .object({
    property: z.string().min(1),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rows: z.number().int().positive().optional(),
    readOnly: z.boolean().optional(),
  })
  .strict();
export type ViewFieldConfig = z.infer<typeof ViewFieldConfig>;

export const ViewFieldsetConfig = z
  .object({
    kind: z.literal('fieldset'),
    title: z.string().min(1),
    fields: z.array(ViewFieldConfig).min(1),
  })
  .strict();
export type ViewFieldsetConfig = z.infer<typeof ViewFieldsetConfig>;

export const ViewItemConfig = z.union([ViewFieldsetConfig, ViewFieldConfig]);
export type ViewItemConfig = z.infer<typeof ViewItemConfig>;

export const ViewConfig = z
  .object({
    name: z.string().min(1),
    title: z.string(),
    fieldWidth: z.number().int().positive().optional(),
    fields: z.array(ViewItemConfig).min(1),
  })
  .strict();
export type ViewConfig = z.infer<typeof ViewConfig>;

export const TransitionConfig = z
  .object({ from: z.array(z.string().min(1)).min(1), to: z.string().min(1), event: z.string().min(1).optional() })
  .strict();
export type TransitionConfig = z.infer<typeof TransitionConfig>;

export const CommandConfig = z
  .object({ name: z.string().min(1), transition: TransitionConfig, hotkey: z.string().length(1).optional() })
  .strict();
export type CommandConfig = z.infer<typeof CommandConfig>;

export const ObjectConfig = z
  .object({
    name: z.string().min(1),
    title: z.string(),
    titlePlural: z.string(),
    lifecycle: Lifecycle,
    properties: z.array(PropertyConfigSchema).min(1),
    lists: z.array(ListConfig),
    views: z.array(ViewConfig).optional(),
    commands: z.array(CommandConfig).optional(),
  })
  .strict();
export type ObjectConfig = z.infer<typeof ObjectConfig>;

const c = () => z.string().min(1);

export const ThemeInput = z
  .object({
    bgColor: c().default('default'),
    textColor: c().default('white'),
    accentColor: c().default('blue'),
    mutedColor: c().default('gray'),
    highlightColor: c().default('yellow'),
    errorColor: c().default('red'),
    selectedBgColor: c().default('blue'),
    selectedTextColor: c().default('black'),
    fieldBgColor: c().default('#202020'),
    fieldTextColor: c().default('white'),
    disabledBgColor: c().optional(),
    disabledTextColor: c().optional(),
    navBgColor: c().optional(),
    navTextColor: c().optional(),
    navSelectedBgColor: c().optional(),
    navSelectedTextColor: c().optional(),
    buttonBgColor: c().optional(),
    buttonTextColor: c().optional(),
    buttonActiveBgColor: c().optional(),
    buttonActiveTextColor: c().optional(),
    buttonDisabledBgColor: c().optional(),
    buttonDisabledTextColor: c().optional(),
    fieldDisabledBgColor: c().optional(),
    fieldDisabledTextColor: c().optional(),
    cursorBgColor: c().optional(),
    cursorTextColor: c().optional(),
  })
  .strict();

export const ThemeConfig = ThemeInput.transform((t) => {
  const disabledBgColor = t.disabledBgColor ?? t.bgColor;
  const disabledTextColor = t.disabledTextColor ?? t.mutedColor;
  const navBgColor = t.navBgColor ?? t.accentColor;
  const navTextColor = t.navTextColor ?? t.selectedTextColor;
  return {
    ...t,
    disabledBgColor,
    disabledTextColor,
    navBgColor,
    navTextColor,
    navSelectedBgColor: t.navSelectedBgColor ?? navTextColor,
    navSelectedTextColor: t.navSelectedTextColor ?? navBgColor,
    buttonBgColor: t.buttonBgColor ?? t.mutedColor,
    buttonTextColor: t.buttonTextColor ?? t.textColor,
    buttonActiveBgColor: t.buttonActiveBgColor ?? t.selectedBgColor,
    buttonActiveTextColor: t.buttonActiveTextColor ?? t.selectedTextColor,
    buttonDisabledBgColor: t.buttonDisabledBgColor ?? disabledBgColor,
    buttonDisabledTextColor: t.buttonDisabledTextColor ?? disabledTextColor,
    fieldDisabledBgColor: t.fieldDisabledBgColor ?? disabledBgColor,
    fieldDisabledTextColor: t.fieldDisabledTextColor ?? disabledTextColor,
    cursorBgColor: t.cursorBgColor ?? t.fieldTextColor,
    cursorTextColor: t.cursorTextColor ?? t.fieldBgColor,
  };
});
export type ThemeConfig = z.infer<typeof ThemeConfig>;

export const PluginEntry = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    config: z.unknown().optional(),
  })
  .strict();
export type PluginEntry = z.infer<typeof PluginEntry>;

export const ConfigSchema = z
  .object({
    version: z.literal('1'),
    theme: ThemeConfig.default(() => ThemeConfig.parse({})),
    objects: z.array(ObjectConfig),
    plugins: z.array(PluginEntry).default([]),
  })
  .strict();
export type Config = z.infer<typeof ConfigSchema>;

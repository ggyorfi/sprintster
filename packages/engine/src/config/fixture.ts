import { loadConfig } from './loader.js';
import type { Config, ObjectConfig } from './schema.js';

const fixtureClientObject = {
  name: 'client',
  title: 'Client',
  titlePlural: 'Clients',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'name', title: 'Name', type: 'text', validation: { required: true, minLength: 1, maxLength: 200 } },
    { name: 'service', title: 'Service', type: 'enum', values: ['student', 'accompaniment', 'other'], default: 'student' },
    { name: 'rate', title: 'Rate', type: 'money', currency: 'GBP', validation: { required: true } },
    { name: 'paymentTermsDays', title: 'Terms', type: 'integer', validation: { required: true, min: 1 }, default: 7 },
    {
      name: 'address',
      title: 'Billing address',
      type: 'object',
      nullable: true,
      properties: [
        { name: 'line1', title: 'Line 1', type: 'text', nullable: true },
        { name: 'line2', title: 'Line 2', type: 'text', nullable: true },
        { name: 'city', title: 'City', type: 'text', nullable: true },
        { name: 'postcode', title: 'Postcode', type: 'text', nullable: true },
      ],
    },
    { name: 'notes', title: 'Notes', type: 'text', validation: { maxLength: 2000 }, nullable: true },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Clients',
      columns: [
        { property: 'id', label: 'ID', width: 10 },
        { property: 'name', label: 'Name', width: 30 },
        { property: 'service', label: 'Service', width: 15 },
        { property: 'rate', label: 'Rate', width: 12 },
        { property: 'paymentTermsDays', label: 'Terms', width: 10, suffix: 'd' },
      ],
      search: { fields: ['name', 'service'], idPrefix: true },
      actions: [
        { hotkey: 'n', label: 'new', kind: 'create', view: 'default' },
        { hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' },
        { hotkey: 'v', label: 'view', kind: 'view', view: 'default' },
        { hotkey: 'd', label: 'del', kind: 'delete' },
      ],
    },
  ],
  views: [
    {
      name: 'default',
      title: 'Client',
      fields: [
        { property: 'name', placeholder: 'e.g. Alfie Granger-Howell' },
        { property: 'service', placeholder: 'student | accompaniment | other' },
        { property: 'rate', label: 'Rate (£)', placeholder: 'e.g. 50 or 50.50' },
        { property: 'paymentTermsDays', label: 'Terms (d)', placeholder: 'e.g. 7' },
        {
          kind: 'fieldset',
          title: 'Billing address',
          fields: [
            { property: 'address.line1', label: 'Line 1' },
            { property: 'address.line2', label: 'Line 2' },
            { property: 'address.city', label: 'City' },
            { property: 'address.postcode', label: 'Postcode' },
          ],
        },
        { property: 'notes', placeholder: 'optional, e.g. legacy id or access notes', rows: 3 },
      ],
    },
  ],
};

const loaded = loadConfig({ version: '1', objects: [fixtureClientObject] });
const client = loaded.objects[0];
if (client === undefined) throw new Error('fixture client config failed to load');

export const fixtureConfig: Config = loaded;
export const fixtureClientConfig: ObjectConfig = client;

const statusObject = {
  name: 'widget',
  title: 'Widget',
  titlePlural: 'Widgets',
  lifecycle: { statusField: 'status' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'number', title: 'No.', type: 'sequence' },
    { name: 'label', title: 'Label', type: 'text', validation: { required: true } },
    { name: 'status', title: 'Status', type: 'enum', values: ['live', 'cancelled', 'paid'], default: 'live' },
  ],
  lists: [
    {
      name: 'default',
      title: 'Widgets',
      columns: [
        { property: 'number', label: 'No.', width: 8 },
        { property: 'label', label: 'Label', width: 20 },
        { property: 'status', label: 'Status', width: 12 },
      ],
      actions: [
        { hotkey: 'n', label: 'new', kind: 'create', view: 'default' },
        { hotkey: 'e', label: 'edit', kind: 'edit', view: 'default' },
      ],
    },
  ],
  views: [{ name: 'default', title: 'Widget', fields: [{ property: 'label' }] }],
  commands: [
    { name: 'cancel', transition: { from: ['live'], to: 'cancelled' }, hotkey: 'c' },
    { name: 'markPaid', transition: { from: ['live'], to: 'paid' }, hotkey: 'p' },
  ],
};

const loadedStatus = loadConfig({ version: '1', objects: [statusObject] });
const widget = loadedStatus.objects[0];
if (widget === undefined) throw new Error('fixture status config failed to load');

export const fixtureStatusObject: ObjectConfig = widget;

const memoObject = {
  name: 'memo',
  title: 'Memo',
  titlePlural: 'Memos',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'client', title: 'Client', type: 'ref', target: 'client', display: 'name', validation: { required: true } },
    { name: 'text', title: 'Text', type: 'text', validation: { required: true } },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [
    {
      name: 'default',
      title: 'Memos',
      columns: [
        { property: 'id', label: 'ID', width: 10 },
        { property: 'client.name', label: 'Client', width: 24 },
        { property: 'text', label: 'Text', width: 30 },
      ],
    },
  ],
  views: [{ name: 'default', title: 'Memo', fields: [{ property: 'client' }, { property: 'text' }] }],
};

const loadedRef = loadConfig({ version: '1', objects: [fixtureClientObject, memoObject] });
const refClient = loadedRef.objects[0];
const memo = loadedRef.objects[1];
if (refClient === undefined || memo === undefined) throw new Error('fixture ref config failed to load');

export const fixtureRefConfig: Config = loadedRef;
export const fixtureRefClientObject: ObjectConfig = refClient;
export const fixtureMemoObject: ObjectConfig = memo;

const themeDefault = {
  bgColor: 'default',
  textColor: 'white',
  accentColor: 'blue',
  mutedColor: 'gray',
  highlightColor: 'yellow',
  errorColor: 'red',
  selectedBgColor: 'blue',
  selectedTextColor: 'black',
  fieldBgColor: '#202020',
  fieldTextColor: 'white',
};

// A raw (unloaded) two-object config for exercising loadConfig end to end.
export const fixtureAppRaw = {
  version: '1',
  theme: themeDefault,
  objects: [fixtureClientObject, memoObject],
};

import React from 'react';
import { Box } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const SHIFT_TAB = `${String.fromCharCode(27)}[Z`;
import { fixtureClientConfig, viewFields, arrayInitialValues, type PropertyConfig, type ViewFieldSpec } from '@sprintster/engine';
import { PopupForm } from './PopupForm.js';

const FIELDS = viewFields(fixtureClientConfig, 'default', 'create');

const emailsProp = {
  name: 'emails',
  title: 'Emails',
  type: 'array',
  item: {
    properties: [
      { name: 'value', title: 'Email', type: 'text' },
      { name: 'label', title: 'Label', type: 'text', nullable: true },
    ],
  },
} satisfies PropertyConfig;

const ARRAY_FIELD: ViewFieldSpec = {
  path: 'emails',
  property: emailsProp,
  label: 'Emails',
  placeholder: '',
  rows: 1,
  group: null,
  editable: true,
  derivedFromRef: null,
  defaultInput: '',
};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function strip(s: string): string {
  return s.replace(ANSI, '');
}

function renderPopup(node: React.JSX.Element): string {
  const { lastFrame } = render(
    <Box width={80} height={26}>
      {node}
    </Box>,
  );
  return strip(lastFrame() ?? '');
}

describe('PopupForm layout (create mode)', () => {
  it('grows to fit a long Notes value without clipping the buttons or help line', () => {
    const longNote =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec';
    const minimal = FIELDS.filter((f) => f.path === 'name' || f.path === 'notes');
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={minimal} initial={{ notes: longNote }} onSubmit={() => {}} onCancel={() => {}} />,
    );

    expect(frame).toContain('alpha');
    expect(frame).toContain('quebec');
    expect(frame).toContain('Save');
    expect(frame).toContain('Cancel');
    expect(frame).toContain('Tab next');

    expect(frame.indexOf('quebec')).toBeLessThan(frame.indexOf('Save'));
    expect(frame.indexOf('Save')).toBeLessThan(frame.indexOf('Tab next'));
  });

  it('edits a markdown field in the multiline text editor (long content wraps, not clipped)', () => {
    const markdownField: ViewFieldSpec = {
      path: 'body',
      property: { name: 'body', title: 'Body', type: 'markdown' },
      label: 'Body',
      placeholder: '',
      rows: 1,
      group: null,
      editable: true,
      derivedFromRef: null,
      defaultInput: '',
    };
    const long =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec';
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={[markdownField]} initial={{ body: long }} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(frame).toContain('alpha');
    expect(frame).toContain('quebec');
    expect(frame.indexOf('alpha')).toBeLessThan(frame.indexOf('quebec'));
  });

  it('encloses an object group in a titled frame', () => {
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={FIELDS} initial={{ name: 'Thomas Lam', notes: '' }} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(frame).toContain('Billing address');
    expect(frame).toContain('╭');
    expect(frame).toContain('╰');
  });

  it('Shift+Tab navigates backward, wrapping from the first field to Cancel', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <PopupForm title="New" mode="create" fields={FIELDS} onSubmit={() => {}} onCancel={onCancel} />,
    );
    stdin.write(SHIFT_TAB);
    await tick();
    stdin.write('\r');
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a short form with the buttons present (no scroll)', () => {
    const minimal = FIELDS.filter((f) => f.path === 'name');
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={minimal} initial={{ name: 'Thomas Lam' }} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(frame).toContain('Save');
    expect(frame).toContain('Cancel');
  });

  it('scrolls a focused middle array item into view (per-stop tracking)', async () => {
    const oneProp = {
      name: 'emails',
      title: 'Emails',
      type: 'array',
      item: { properties: [{ name: 'value', title: 'Email', type: 'text' }] },
    } satisfies PropertyConfig;
    const oneField: ViewFieldSpec = { ...ARRAY_FIELD, property: oneProp };
    const items = Array.from({ length: 8 }, (_, i) => ({ value: `addr${i}@x.com` }));
    const initial = arrayInitialValues(oneProp, 'emails', items);
    const { lastFrame, stdin } = render(
      <Box width={70} height={26}>
        <PopupForm title="C" mode="create" fields={[oneField]} initial={initial} onSubmit={() => {}} onCancel={() => {}} />
      </Box>,
    );
    const snap = (): string => (lastFrame() ?? '').replace(ANSI, '');
    for (let i = 0; i < 8; i += 1) {
      // each item is value + Del => 2 stops; 8 tabs reaches item 4's value field
      stdin.write('\t');
      await tick();
    }
    const frame = snap();
    expect(frame).toContain('addr4@x.com'); // focused item visible
    expect(frame).not.toContain('addr0@x.com'); // top clipped
    expect(frame).not.toContain('addr7@x.com'); // bottom clipped
  });

  it('caps a tall form to the screen and shows the scroll-down hint', () => {
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={FIELDS} initial={{ name: 'Thomas Lam' }} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const lines = frame.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeLessThanOrEqual(26 - 2); // screen height minus top+bottom margin
    expect(frame).toContain('↓'); // more content below
  });
});

describe('PopupForm array field (repeating group)', () => {
  it('renders the box title, the item value, and Add + Delete pills on the border', () => {
    const initial = arrayInitialValues(emailsProp, 'emails', [{ value: 'a@x', label: 'home' }]);
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={[ARRAY_FIELD]} initial={initial} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(frame).toContain('Emails'); // plural title on the box border
    expect(frame).toContain('a@x');
    expect(frame).toContain('Add'); // add pill on the bottom border
    expect(frame).toContain('Del'); // delete pill for the item
  });

  it('starts empty with an Add pill and no Delete pill', () => {
    const frame = renderPopup(
      <PopupForm title="New" mode="create" fields={[ARRAY_FIELD]} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(frame).toContain('Add');
    expect(frame).not.toContain('Del');
  });

  it('adds an item on Enter, captures its value, and submits indexed values', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <PopupForm title="New" mode="create" fields={[ARRAY_FIELD]} onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await tick();
    stdin.write('\r'); // active starts on "+ add"; Enter appends an item
    await tick();
    stdin.write('a@x'); // type into the new item's value field
    await tick();
    for (let k = 0; k < 4; k += 1) {
      stdin.write('\t'); // value -> label -> remove -> add -> save
      await tick();
    }
    stdin.write('\r'); // Enter on Save
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]!['emails.0.value']).toBe('a@x');
  });
});

describe('PopupForm view mode', () => {
  it('hides Save/Cancel buttons and shows the close legend', () => {
    const fields = viewFields(fixtureClientConfig, 'default', 'view');
    const frame = renderPopup(
      <PopupForm title="View" mode="view" fields={fields} initial={{ name: 'Thomas Lam', service: 'student' }} onCancel={() => {}} />,
    );
    expect(frame).not.toContain('Save');
    expect(frame).toContain('Thomas Lam');
    expect(frame).toContain('close');
  });

  it.skip('Esc, Enter, and "v" all close the panel', async () => {
    const fields = viewFields(fixtureClientConfig, 'default', 'view');
    for (const keystroke of ['', '\r', 'v']) {
      const onCancel = vi.fn();
      const { stdin } = render(
        <PopupForm title="View" mode="view" fields={fields} initial={{ name: 'A' }} onCancel={onCancel} />,
      );
      stdin.write(keystroke);
      await tick();
      expect(onCancel).toHaveBeenCalledTimes(1);
    }
  });
});

describe('PopupForm dimmed read-only field', () => {
  it('renders a value without a TextInput widget when field.editable is false', () => {
    const fields = viewFields(fixtureClientConfig, 'default', 'view');
    const frame = renderPopup(
      <PopupForm title="View" mode="view" fields={fields} initial={{ rate: '5000' }} onCancel={() => {}} />,
    );
    expect(frame).toContain('£50');
  });
});

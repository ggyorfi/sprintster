import { describe, it, expect } from 'vitest';
import { fixtureClientConfig, fixtureStatusObject } from '@sprintster/engine';
import { commandHints, filterHelp, listActions, objectHelp } from './help.js';
import type { ObjectConfig } from '@sprintster/engine';

describe('objectHelp', () => {
  it('renders the actions declared on the default list in order', () => {
    const help = objectHelp(fixtureClientConfig);
    expect(help).toContain('n new');
    expect(help).toContain('e edit');
    expect(help).toContain('v view');
    expect(help).toContain('d del');
    expect(help.indexOf('n new')).toBeLessThan(help.indexOf('e edit'));
    expect(help.indexOf('e edit')).toBeLessThan(help.indexOf('v view'));
  });

  it('includes command hotkeys from the object (e.g. statusField transitions)', () => {
    const help = objectHelp(fixtureStatusObject);
    expect(help).toContain('c cancel');
    expect(help).toContain('p markPaid');
  });
});

describe('filterHelp', () => {
  it('keeps "/ refine" and shows the same actions + commands', () => {
    const help = filterHelp(fixtureStatusObject);
    expect(help).toContain('/ refine');
    expect(help).toContain('c cancel');
    expect(help).toContain('p markPaid');
  });
});

describe('commandHints', () => {
  it('skips commands without a hotkey', () => {
    const obj = { ...fixtureStatusObject, commands: [{ name: 'silent', transition: { from: ['live'], to: 'paid' } }] };
    expect(commandHints(obj)).toEqual([]);
  });
});

describe('listActions', () => {
  it('returns the configured actions for the default list', () => {
    const actions = listActions(fixtureClientConfig);
    expect(actions.map((a) => a.hotkey)).toEqual(['n', 'e', 'v', 'd']);
  });

  it('returns an empty list when no actions are declared', () => {
    const stripped: ObjectConfig = {
      ...fixtureClientConfig,
      lists: fixtureClientConfig.lists.map((l) => ({ ...l, actions: undefined })),
    };
    expect(listActions(stripped)).toEqual([]);
  });
});

describe('read-only list (no actions, e.g. a plugin reader with view-only action)', () => {
  it('objectHelp omits new/edit/delete when not in actions', () => {
    const readonly: ObjectConfig = {
      ...fixtureClientConfig,
      lists: fixtureClientConfig.lists.map((l) => ({
        ...l,
        actions: [{ hotkey: 'v' as const, label: 'view', kind: 'view' as const, view: 'default' }],
      })),
    };
    const help = objectHelp(readonly);
    expect(help).not.toContain('n new');
    expect(help).not.toContain('e edit');
    expect(help).not.toContain('d del');
    expect(help).toContain('v view');
    expect(help).toContain('r refresh');
    expect(help).toContain('q quit');
  });
});

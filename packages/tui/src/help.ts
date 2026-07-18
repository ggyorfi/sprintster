import type { ListActionConfig, ObjectConfig } from '@sprintster/engine';

export function listActions(obj: ObjectConfig, listName = 'default'): ReadonlyArray<ListActionConfig> {
  const list = obj.lists.find((l) => l.name === listName) ?? obj.lists[0];
  return list?.actions ?? [];
}

export function commandHints(obj: ObjectConfig): string[] {
  return (obj.commands ?? [])
    .filter((c) => c.hotkey !== undefined)
    .map((c) => `${c.hotkey} ${c.name}`);
}

function actionHints(obj: ObjectConfig): string[] {
  return listActions(obj).map((a) => `${a.hotkey} ${a.label}`);
}

export function objectHelp(obj: ObjectConfig): string {
  return ['/ find', 'jk/↑↓ move', '^f/^b page', 'g/G ends', ...actionHints(obj), ...commandHints(obj), 'r refresh', 'q quit'].join(' · ');
}

export function filterHelp(obj: ObjectConfig): string {
  return ['Esc clear', '/ refine', 'jk move', ...actionHints(obj), ...commandHints(obj), 'q quit'].join(' · ');
}

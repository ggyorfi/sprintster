import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useExtensions, type Extensions } from './extensions.js';

const config = {
  extensions: {
    actions: [{ id: 'pub.publish', label: 'Publish', route: '/plugins/pub/requests', hotkey: 'p' }],
    badges: [{ id: 'pub.changes', route: '/plugins/pub/status' }],
  },
};

async function until(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 1500) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('useExtensions', () => {
  it('loads declared extensions, shows badge text and reloads it after an action', async () => {
    let changes = 2;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/config')) return Response.json(config);
      if (init?.method === 'POST') {
        changes = 0;
        return Response.json({ message: 'Publishing.' });
      }
      return Response.json({ text: `${changes} changes` });
    }) as unknown as typeof fetch;
    let latest: Extensions | undefined;
    function Probe() {
      latest = useExtensions('http://d', fetchMock);
      return <Text>{latest.badges}</Text>;
    }
    const { lastFrame } = render(<Probe />);
    await until(() => (lastFrame() ?? '').includes('2 changes'));
    expect(latest!.actions.map((a) => a.hotkey)).toEqual(['p']);
    expect(await latest!.run(latest!.actions[0]!)).toBe('Publishing.');
    await until(() => (lastFrame() ?? '').includes('0 changes'));
  });
});

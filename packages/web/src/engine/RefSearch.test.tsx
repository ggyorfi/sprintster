import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtureClientConfig, fixtureMemoObject, loadConfig, setAppConfig, type ApiClient, type ListParams } from '@sprintster/engine';
import { ObjectPanel } from './ObjectPanel.js';
import { makeResolveObject, type Row } from './resolve.js';

const config = loadConfig({ version: '1', objects: [fixtureClientConfig, fixtureMemoObject] });
setAppConfig(config);
const memo = config.objects.find((o) => o.name === 'memo')!;
const clients: Row[] = [
  { id: 'c1', name: 'Anna' },
  { id: 'c2', name: 'Béla' },
  { id: 'c3', name: 'Cecil' },
];

describe('ref pickers search on the server (ADR 24)', () => {
  it('loads the chosen record by id, then asks the server as the user types', async () => {
    const asked: ListParams[] = [];
    const api = {
      object: () => ({
        page: async (params: ListParams) => {
          asked.push(params);
          const byIds = params.ids === undefined ? clients : clients.filter((c) => params.ids!.includes(String(c.id)));
          const rows = params.q === undefined ? byIds.slice(0, 1) : byIds.filter((c) => String(c['name']).toLowerCase().startsWith(params.q!.toLowerCase().slice(0, 2)));
          return { rows, total: rows.length, next: null };
        },
        get: async () => null,
      }),
    } as unknown as ApiClient;
    render(
      <ObjectPanel
        api={api}
        obj={memo}
        resolveObject={makeResolveObject(config.objects)}
        initialMode="edit"
        row={{ id: 'm1', client: 'c3', text: 'hello' }}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    await waitFor(() => expect(asked.some((p) => p.ids?.includes('c3'))).toBe(true));
    expect(asked.every((p) => (p.limit ?? 0) <= 100)).toBe(true);
    expect(await screen.findByText('Cecil')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'be');
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ q: 'be' }));
    expect(await screen.findByText('Béla')).toBeInTheDocument();
  });
});

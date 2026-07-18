import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appConfig, setAppConfig, fixtureConfig, type ApiClient } from '@sprintster/engine';
import { ObjectScreen } from './ObjectScreen.js';
import { makeResolveObject, type Row } from './resolve.js';

setAppConfig(fixtureConfig);
const client = appConfig.objects.find((o) => o.name === 'client')!;
const resolveObject = makeResolveObject();

function makeApi(seed: Record<string, Row[]>, add: ReturnType<typeof vi.fn>): ApiClient {
  return {
    object: () => ({
      list: async () => seed['client'] ?? [],
      add,
      update: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
      get: async () => null,
      status: async () => null,
      sync: async () => ({}),
      refresh: async () => null,
    }),
  } as unknown as ApiClient;
}

describe('ObjectScreen create flow', () => {
  it('opens the form, assembles config-driven values, and posts them', async () => {
    const add = vi.fn(async (input: Row) => input);
    const seed: Record<string, Row[]> = {
      client: [{ id: 'c1', name: 'Existing', service: 'student', rate: '4000', paymentTermsDays: 7, removed: false }],
    };
    render(<ObjectScreen api={makeApi(seed, add)} obj={client} resolveObject={resolveObject} />);

    expect(await screen.findByText('Existing')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /New client/i }));
    const dialog = await screen.findByRole('dialog', { name: 'New Client' });

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Test Person');
    await userEvent.type(within(dialog).getByLabelText('Rate (£)'), '55');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(add).toHaveBeenCalledOnce();
    const payload = add.mock.calls[0]![0] as Row;
    expect(payload['name']).toBe('Test Person');
    expect(payload['rate']).toBe('5500');
    expect(payload['service']).toBe('student');
    expect(payload['paymentTermsDays']).toBe(7);
    expect(payload['id']).toBeDefined();
  });

  it('opens the edit dialog from the row edit icon', async () => {
    const seed: Record<string, Row[]> = {
      client: [{ id: 'c1', name: 'Existing', service: 'student', rate: '4000', paymentTermsDays: 7, removed: false }],
    };
    render(<ObjectScreen api={makeApi(seed, vi.fn())} obj={client} resolveObject={resolveObject} />);

    await screen.findByText('Existing');
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);

    expect(await screen.findByRole('dialog', { name: 'Edit Client' })).toBeInTheDocument();
  });
});

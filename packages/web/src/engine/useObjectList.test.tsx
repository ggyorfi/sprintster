import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appConfig, setAppConfig, fixtureConfig, fixtureAppRaw, loadConfig, type ApiClient, type ListParams } from '@sprintster/engine';
import { LIST_PAGE, useObjectList } from './useObjectList.js';
import { ObjectScreen } from './ObjectScreen.js';
import { makeResolveObject } from './resolve.js';

setAppConfig(fixtureConfig);
const client = appConfig.objects.find((o) => o.name === 'client')!;
const resolveObject = makeResolveObject();
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, service: 'student', rate: '100', paymentTermsDays: 7 }));

// Answers offset pages as the daemon does (ADR 24): a total unless count is false.
function pagedApi(clients = many(5)) {
  const calls: ListParams[] = [];
  const get = vi.fn(async (id: string) => ({ ...clients.find((c) => c.id === id)!, notes: 'full record' }));
  const page = vi.fn(async (params: ListParams) => {
    calls.push(params);
    const matching = params.q === undefined ? clients : clients.filter((c) => c.name.toLowerCase().includes(params.q!.toLowerCase()));
    const from = params.offset ?? 0;
    const rows = matching.slice(from, from + (params.limit ?? 50));
    return { rows, ...(params.count === false ? {} : { total: matching.length }), next: null };
  });
  const api = { object: () => ({ page, get }) } as unknown as ApiClient;
  return { api, calls, get };
}

describe('useObjectList (ADR 24)', () => {
  it('learns the total from the first page, then fetches a page in view by offset without counting', async () => {
    const { api, calls } = pagedApi(many(250));
    const { result } = renderHook(() => useObjectList(api, client, resolveObject));
    await waitFor(() => expect(result.current.total).toBe(250));
    expect(calls[0]).toMatchObject({ offset: 0, limit: LIST_PAGE, fields: expect.arrayContaining(['name', 'removed']) });
    expect(calls[0]!.count).toBeUndefined();
    expect(result.current.rowAt(5)?.['id']).toBe('c5');
    expect(result.current.rowAt(210)).toBeUndefined();
    act(() => result.current.show(200, 230));
    await waitFor(() => expect(result.current.rowAt(210)?.['id']).toBe('c210'));
    expect(calls.map((c) => [c.offset, c.count])).toEqual([[0, undefined], [200, false]]);
  });

  it('fetches only the pages where scrolling stops, never the ones passed on the way', async () => {
    const { api, calls } = pagedApi(many(500));
    const { result } = renderHook(() => useObjectList(api, client, resolveObject));
    await waitFor(() => expect(result.current.total).toBe(500));
    act(() => {
      result.current.show(100, 130);
      result.current.show(250, 280);
      result.current.show(450, 480);
    });
    await waitFor(() => expect(result.current.rowAt(470)?.['id']).toBe('c470'));
    expect(calls.map((c) => c.offset)).toEqual([0, 400]);
  });

  it('starts over from the first page for a new search', async () => {
    const { api, calls } = pagedApi();
    const { result, rerender } = renderHook(({ q }) => useObjectList(api, client, resolveObject, q), { initialProps: { q: '' } });
    await waitFor(() => expect(result.current.total).toBe(5));
    rerender({ q: 'client 3' });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(result.current.rowAt(0)?.['id']).toBe('c3');
    expect(calls.at(-1)).toMatchObject({ q: 'client 3', offset: 0 });
  });
});

describe('ObjectScreen paging (ADR 24)', () => {
  it('searches as the user types, shows the total, and opens the full record for editing', async () => {
    const { api, calls, get } = pagedApi();
    render(<ObjectScreen api={api} obj={client} resolveObject={resolveObject} />);
    expect(await screen.findByText('Client 4')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Search clients/i), 'client 2');
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ q: 'client 2' }));
    expect(await screen.findByText('1 found')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Edit Client' });
    expect(get).toHaveBeenCalledWith('c2');
    expect(within(dialog).getByDisplayValue('full record')).toBeInTheDocument();
  });

  it('shows placeholder rows, without buttons, where the page is not loaded yet', async () => {
    const clients = many(150);
    const hold = new Promise<void>(() => {});
    const page = vi.fn(async (params: ListParams) => {
      if ((params.offset ?? 0) > 0) await hold;
      return { rows: clients.slice(0, 100), total: 150, next: null };
    });
    const api = { object: () => ({ page, get: async () => null }) } as unknown as ApiClient;
    const { container } = render(<ObjectScreen api={api} obj={client} resolveObject={resolveObject} />);
    await screen.findByText('Client 0');
    const scroller = container.querySelector('[class*="tableWrap"]') as HTMLDivElement;
    Object.defineProperty(scroller, 'clientHeight', { value: 400 });
    scroller.scrollTop = 41 * 120;
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(container.querySelectorAll('[class*="skeleton"]').length).toBeGreaterThan(0));
    await waitFor(() => expect(page.mock.calls.some(([p]) => p.offset === 100 && p.count === false)).toBe(true));
  });
});

describe('list filters (ADR 27)', () => {
  it('offers each filter group as a switch, sends the chosen option by name, and clears it with All', async () => {
    const config = loadConfig({
      ...fixtureAppRaw,
      objects: fixtureAppRaw.objects.map((o: { name: string; lists?: unknown[] }) =>
        o.name === 'client'
          ? { ...o, lists: [{ ...(o.lists as Array<Record<string, unknown>>)[0], filters: [{ label: 'Service', options: [{ label: 'Students', property: 'service', equals: 'student' }, { label: 'Others', property: 'service', notEquals: 'student' }] }] }] }
          : o,
      ),
    });
    setAppConfig(config);
    const obj = config.objects.find((o) => o.name === 'client')!;
    const { api, calls } = pagedApi();
    render(<ObjectScreen api={api} obj={obj} resolveObject={makeResolveObject(config.objects)} />);
    await screen.findByText('Client 0');
    const group = screen.getByRole('group', { name: 'Service' });
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'Others' }));
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ filter: ['Service:Others'], offset: 0 }));
    expect(within(group).getByRole('button', { name: 'Others' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(calls.at(-1)!.filter).toBeUndefined());
    setAppConfig(fixtureConfig);
  });
});

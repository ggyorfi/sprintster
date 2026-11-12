import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordAction } from './RecordAction.js';

afterEach(() => vi.unstubAllGlobals());

const action = { id: 'pub.record', label: 'Publish', route: '/plugins/pub/records/publish', input: { type: 'datetime' as const, label: 'On (empty: now)', optional: true } };

describe('RecordAction (ADR 25)', () => {
  it('asks for the date, posts it as an instant, and posts null when left empty', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ message: 'Scheduled.' });
    }));
    const onDone = vi.fn();
    render(<RecordAction baseUrl="/api" action={action} record={{ object: 'article', id: 'a1' }} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.change(screen.getByLabelText('On (empty: now)'), { target: { value: '2030-01-02T08:30' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Publish' }).at(-1)!);
    expect(bodies[0]).toEqual({ object: 'article', id: 'a1', value: new Date('2030-01-02T08:30').toISOString().replace(/\.\d{3}Z$/, 'Z') });
    expect(onDone).toHaveBeenCalledWith({ text: 'Scheduled.', failed: false });

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Publish' }).at(-1)!);
    expect(bodies[1]).toEqual({ object: 'article', id: 'a1', value: null });
  });

  it('stays disabled when told to', () => {
    render(<RecordAction baseUrl="/api" action={action} record={{ object: 'article', id: 'a1' }} disabled onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefCards } from './RefCards.js';

const options = [
  { value: 'a', label: 'Ring front', thumb: '/assets/a' },
  { value: 'b', label: 'Ring side', thumb: '/assets/b' },
  { value: 'c', label: 'Earrings', thumb: '/assets/c' },
];

describe('RefCards (refs)', () => {
  it('shows each chosen record as a card with its picture, in order', () => {
    const { container } = render(<RefCards label="Images" value='["b","a"]' options={options} onChange={() => {}} multiple />);
    expect([...container.querySelectorAll('li img')].map((i) => i.getAttribute('src'))).toEqual(['/assets/b', '/assets/a']);
  });

  it('moves and removes cards', async () => {
    const onChange = vi.fn();
    render(<RefCards label="Images" value='["a","b","c"]' options={options} onChange={onChange} multiple />);
    await userEvent.click(screen.getByRole('button', { name: 'Move Ring side earlier' }));
    expect(onChange).toHaveBeenLastCalledWith('["b","a","c"]');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Earrings' }));
    expect(onChange).toHaveBeenLastCalledWith('["a","b"]');
  });

  it('reorders by drag and drop', () => {
    const onChange = vi.fn();
    const { container } = render(<RefCards label="Images" value='["a","b","c"]' options={options} onChange={onChange} multiple />);
    const cards = container.querySelectorAll('li[draggable="true"]');
    fireEvent.dragStart(cards[2]!);
    fireEvent.drop(cards[0]!);
    expect(onChange).toHaveBeenLastCalledWith('["c","a","b"]');
  });

  it('adds several from the dialog, in the order picked, offering only unchosen ones', async () => {
    const onChange = vi.fn();
    render(<RefCards label="Images" value='["a"]' options={options} onChange={onChange} multiple />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /Ring front/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: /Earrings/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Ring side/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 2' }));
    expect(onChange).toHaveBeenLastCalledWith('["a","c","b"]');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('filters the dialog by search', async () => {
    render(<RefCards label="Images" value="[]" options={options} onChange={() => {}} multiple />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    await userEvent.type(screen.getByRole('searchbox'), 'ear');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Earrings/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Ring side/ })).toBeNull();
  });
});

describe('RefCards (ref)', () => {
  it('replaces the value with one click in the dialog', async () => {
    const onChange = vi.fn();
    render(<RefCards label="Logo" value="a" options={options} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Change/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Earrings/ }));
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('RefCards upload', () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])], 'new-ring.png', { type: 'image/png' });

  it('uploads into the dialog, preselected, and adds it with Add', async () => {
    const onChange = vi.fn();
    const upload = vi.fn(async () => ({ value: 'n1', label: 'new-ring', thumb: '/assets/n' }));
    render(<RefCards label="Images" value='["a"]' options={options} onChange={onChange} multiple upload={upload} />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    await userEvent.upload(screen.getByLabelText('Upload files'), png());
    expect(await within(screen.getByRole('dialog')).findByRole('button', { name: /new-ring/, pressed: true })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add 1' }));
    expect(onChange).toHaveBeenLastCalledWith('["a","n1"]');
  });

  it('reports a failed upload and offers no upload without the prop', async () => {
    const upload = vi.fn(async () => {
      throw new Error('too big');
    });
    const { unmount } = render(<RefCards label="Images" value="[]" options={options} onChange={() => {}} multiple upload={upload} />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    await userEvent.upload(screen.getByLabelText('Upload files'), png());
    expect(await screen.findByRole('alert')).toHaveTextContent('new-ring.png: too big');
    unmount();
    render(<RefCards label="Images" value="[]" options={options} onChange={() => {}} multiple />);
    await userEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(screen.queryByLabelText('Upload files')).toBeNull();
  });
});

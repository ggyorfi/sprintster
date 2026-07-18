import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Picker, PickerOverlay, type PickerOption } from './Picker.js';

const ENUM_OPTS: PickerOption[] = [
  { id: 'student', label: 'student' },
  { id: 'accompaniment', label: 'accompaniment' },
  { id: 'other', label: 'other' },
];

const REF_OPTS: PickerOption[] = [
  { id: 'id-1', label: 'Alfie Granger' },
  { id: 'id-2', label: 'Thomas Lam' },
  { id: 'id-3', label: 'Mira Chen' },
];

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ARROW_DOWN = `${String.fromCharCode(27)}[B`;
const CTRL_P = String.fromCharCode(16);

describe('Picker over an enum (id === label)', () => {
  it('shows only the current value when not focused', () => {
    const { lastFrame } = render(
      <Picker value="accompaniment" options={ENUM_OPTS} onChange={() => {}} focus={false} width={20} />,
    );
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('accompaniment');
    expect(f).not.toContain('student');
  });

  it('stays a single line when focused (the list floats separately)', () => {
    const { lastFrame } = render(
      <Picker value="student" options={ENUM_OPTS} onChange={() => {}} focus={true} width={20} />,
    );
    const f = strip(lastFrame() ?? '');
    expect(f.split('\n').filter((l) => l.trim() !== '').length).toBe(1);
    expect(f).toContain('student');
    expect(f).not.toContain('accompaniment');
  });

  it('advances the id on down arrow', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <Picker value="student" options={ENUM_OPTS} onChange={onChange} focus={true} width={20} />,
    );
    stdin.write(ARROW_DOWN);
    await tick();
    expect(onChange).toHaveBeenCalledWith('accompaniment');
  });

  it('wraps backwards on ctrl+p (perpetual nav)', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <Picker value="student" options={ENUM_OPTS} onChange={onChange} focus={true} width={20} />,
    );
    stdin.write(CTRL_P);
    await tick();
    expect(onChange).toHaveBeenCalledWith('other');
  });
});

describe('Picker over refs (id !== label)', () => {
  it('shows the label of the current id, not the id itself', () => {
    const { lastFrame } = render(
      <Picker value="id-2" options={REF_OPTS} onChange={() => {}} focus={false} width={20} />,
    );
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('Thomas Lam');
    expect(f).not.toContain('id-2');
  });

  it('shows the placeholder when nothing is selected', () => {
    const { lastFrame } = render(
      <Picker value="" options={REF_OPTS} onChange={() => {}} focus={false} width={20} placeholder="pick one" />,
    );
    expect(strip(lastFrame() ?? '')).toContain('pick one');
  });

  it('advances to the next id on down arrow', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <Picker value="id-1" options={REF_OPTS} onChange={onChange} focus={true} width={20} />,
    );
    stdin.write(ARROW_DOWN);
    await tick();
    expect(onChange).toHaveBeenCalledWith('id-2');
  });

  it('does nothing when there are no options', async () => {
    const onChange = vi.fn();
    const { stdin } = render(<Picker value="" options={[]} onChange={onChange} focus={true} width={20} />);
    stdin.write(ARROW_DOWN);
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('PickerOverlay', () => {
  it('lists every option flush, no marker prefix, highlights the selected', () => {
    const { lastFrame } = render(<PickerOverlay options={ENUM_OPTS} selectedId="accompaniment" width={20} />);
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('student');
    expect(f).toContain('accompaniment');
    expect(f).toContain('other');
    expect(f).not.toContain('>');
  });

  it('renders ref labels and highlights by id', () => {
    const { lastFrame } = render(<PickerOverlay options={REF_OPTS} selectedId="id-2" width={20} />);
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('Alfie Granger');
    expect(f).toContain('Thomas Lam');
    expect(f).toContain('Mira Chen');
  });
});

describe('Picker fuzzy filter (typeahead, no input field)', () => {
  it('accepts a char when at least one option would still match, and reports the new filter', async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <Picker
        value="id-1"
        options={REF_OPTS}
        onChange={() => {}}
        focus={true}
        width={30}
        filter=""
        onFilterChange={onFilterChange}
      />,
    );
    stdin.write('m');
    await tick();
    expect(onFilterChange).toHaveBeenCalledWith('m');
  });

  it('ignores a char when no option would match (filter stays put)', async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <Picker
        value="id-1"
        options={REF_OPTS}
        onChange={() => {}}
        focus={true}
        width={30}
        filter=""
        onFilterChange={onFilterChange}
      />,
    );
    stdin.write('z');
    await tick();
    stdin.write('q');
    await tick();
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('auto-corrects value to the first match when typing pushes the current value out of the filtered set', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <Picker
        value="id-1"
        options={REF_OPTS}
        onChange={onChange}
        focus={true}
        width={30}
        filter=""
        onFilterChange={() => {}}
      />,
    );
    stdin.write('m');
    await tick();
    expect(onChange).toHaveBeenCalledWith('id-2');
  });

  it('keeps the current value when it still matches the new filter', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <Picker
        value="id-3"
        options={REF_OPTS}
        onChange={onChange}
        focus={true}
        width={30}
        filter=""
        onFilterChange={() => {}}
      />,
    );
    stdin.write('m');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('backspace shrinks the filter', async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <Picker
        value="id-3"
        options={REF_OPTS}
        onChange={() => {}}
        focus={true}
        width={30}
        filter="mc"
        onFilterChange={onFilterChange}
      />,
    );
    stdin.write('');
    await tick();
    expect(onFilterChange).toHaveBeenCalledWith('m');
  });

  it('arrow nav cycles only within the filtered set', async () => {
    const onChange = vi.fn();
    const opts: PickerOption[] = [
      { id: '1', label: 'Alpha' },
      { id: '2', label: 'Beta' },
      { id: '3', label: 'Alphonse' },
    ];
    const { stdin } = render(
      <Picker
        value="1"
        options={opts}
        onChange={onChange}
        focus={true}
        width={30}
        filter="al"
        onFilterChange={() => {}}
      />,
    );
    stdin.write(ARROW_DOWN);
    await tick();
    expect(onChange).toHaveBeenCalledWith('3');
  });
});

describe('PickerOverlay match highlighting', () => {
  it('renders option labels with the matched chars present in the output (the parent Text style still wraps them)', () => {
    const opts = [{ id: '1', label: 'Alfie Granger', matches: [0, 2, 5] as const }];
    const { lastFrame } = render(<PickerOverlay options={opts} selectedId="x" width={30} />);
    const f = strip(lastFrame() ?? '');
    expect(f).toContain('Alfie Granger');
  });
});

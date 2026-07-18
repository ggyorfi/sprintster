import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MultilineInput } from './MultilineInput.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('MultilineInput', () => {
  it('reserves at least minRows lines of height', () => {
    const { lastFrame } = render(
      <MultilineInput value="" onChange={() => {}} focus={false} width={20} minRows={3} />,
    );
    expect((lastFrame() ?? '').split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('grows beyond minRows as content wraps', () => {
    const { lastFrame } = render(
      <MultilineInput value={'x'.repeat(45)} onChange={() => {}} focus={false} width={20} minRows={1} />,
    );
    expect((lastFrame() ?? '').split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('grows the height when a full line pushes the cursor to the next row', () => {
    const { lastFrame } = render(
      <MultilineInput value={'x'.repeat(20)} onChange={() => {}} focus={true} width={20} minRows={1} />,
    );
    expect((lastFrame() ?? '').split('\n').length).toBeGreaterThanOrEqual(2);
  });

  it('inserts a typed character at the cursor', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <MultilineInput value="" onChange={onChange} focus={true} width={20} minRows={1} />,
    );
    stdin.write('h');
    await tick();
    expect(onChange).toHaveBeenCalledWith('h');
  });
});

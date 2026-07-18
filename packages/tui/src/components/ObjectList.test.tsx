import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { listColumns, fixtureClientConfig, fixtureRefConfig, fixtureMemoObject } from '@sprintster/engine';
import { ObjectList } from './ObjectList.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');

const COLUMNS = listColumns(fixtureClientConfig);

function makeRows(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(2, '0')}-0000-4000-8000-000000000000`,
    name: `Client${String(i).padStart(2, '0')}`,
    service: 'student',
    rate: '5000',
    paymentTermsDays: 7,
    address: null,
    notes: null,
    removed: false,
  }));
}

describe('ObjectList windowing', () => {
  it('renders only the visible slice (scrollTop .. scrollTop + capacity)', () => {
    const { lastFrame } = render(
      <ObjectList rows={makeRows(100)} columns={COLUMNS} idField="id" selectedIndex={22} width={80} scrollTop={20} capacity={5} />,
    );
    const frame = strip(lastFrame() ?? '');

    expect(frame).toContain('Client20');
    expect(frame).toContain('Client24');
    expect(frame).not.toContain('Client19');
    expect(frame).not.toContain('Client25');
    expect(frame).not.toContain('Client00');
    expect(frame).not.toContain('Client99');
  });

  it('clamps scrollTop so it never scrolls past the last full page', () => {
    const { lastFrame } = render(
      <ObjectList rows={makeRows(100)} columns={COLUMNS} idField="id" selectedIndex={99} width={80} scrollTop={999} capacity={5} />,
    );
    const frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Client95');
    expect(frame).toContain('Client99');
    expect(frame).not.toContain('Client94');
  });
});

describe('ObjectList ref-traversal column', () => {
  const resolve = (name: string) => fixtureRefConfig.objects.find((o) => o.name === name);
  const COLUMNS = listColumns(fixtureMemoObject, 'default', resolve);

  it('renders the pre-joined value stored under the dotted key', () => {
    const rows = [
      { id: 'm1-0000-4000-8000-000000000000', client: 'c1', text: 'call back', 'client.name': 'Alfie Granger' },
    ];
    const { lastFrame } = render(
      <ObjectList rows={rows} columns={COLUMNS} idField="id" selectedIndex={-1} width={80} scrollTop={0} capacity={5} />,
    );
    expect(strip(lastFrame() ?? '')).toContain('Alfie Granger');
  });
});

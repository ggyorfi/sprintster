import type { ReactNode } from 'react';
import { formatCell, type ListColumnSpec, type LifecycleInfo } from '@sprintster/engine';
import { Pill } from '../ui/index.js';
import { statusTone, type Row } from './resolve.js';

const MISSING = String.fromCharCode(0x2014);

export function renderCell(col: ListColumnSpec, row: Row, lifecycle: LifecycleInfo): ReactNode {
  const value = row[col.key];
  if (lifecycle.kind === 'statusField' && col.key === lifecycle.field && value != null) {
    const v = String(value);
    return <Pill tone={statusTone(v)}>{v}</Pill>;
  }
  const text = formatCell(col.property, value, col.suffix);
  return text === '' ? MISSING : text;
}

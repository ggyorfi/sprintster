import type { ReactNode } from 'react';
import { formatCell, thumbnailHash, type ListColumnSpec, type LifecycleInfo } from '@sprintster/engine';
import { Pill } from '../ui/index.js';
import { assetUrl } from '../api/assets.js';
import { statusTone, thumbKey, type Row } from './resolve.js';
import styles from './cells.module.css';

const MISSING = String.fromCharCode(0x2014);

export function renderCell(col: ListColumnSpec, row: Row, lifecycle: LifecycleInfo): ReactNode {
  if (col.thumbnail) {
    const hash = thumbnailHash(col.property.type === 'image' ? row[col.key] : row[thumbKey(col.key)]);
    return hash === null ? <span className={styles.thumb} /> : <img className={styles.thumb} src={assetUrl(hash)} alt="" loading="lazy" />;
  }
  const value = row[col.key];
  if (lifecycle.kind === 'statusField' && col.key === lifecycle.field && value != null) {
    const v = String(value);
    return <Pill tone={statusTone(v)}>{v}</Pill>;
  }
  const text = formatCell(col.property, value, col.suffix);
  return text === '' ? MISSING : text;
}

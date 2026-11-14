import type { ReactNode } from 'react';
import { columnValue, formatCell, thumbnailHash, type ListColumnSpec, type LifecycleInfo } from '@sprintster/engine';
import { Pill } from '../ui/index.js';
import { assetUrl } from '../api/assets.js';
import { statusTone, thumbKey, type Row } from './resolve.js';
import styles from './cells.module.css';

const MISSING = String.fromCharCode(0x2014);

export function renderCell(col: ListColumnSpec, row: Row, lifecycle: LifecycleInfo): ReactNode {
  if (col.thumbnail && col.property.type === 'file') {
    const file = row[col.key] as { contentType?: string; filename?: string } | null | undefined;
    if (file != null && file.contentType?.startsWith('image/') !== true) {
      const ext = /\.(\w{1,4})$/.exec(file.filename ?? '')?.[1]?.toUpperCase() ?? 'FILE';
      return <span className={`${styles.thumb} ${styles.fileType}`}>{ext}</span>;
    }
  }
  if (col.thumbnail) {
    const own = col.property.type === 'image' || col.property.type === 'file';
    const hash = thumbnailHash(own ? row[col.key] : row[thumbKey(col.key)]);
    return hash === null ? <span className={styles.thumb} /> : <img className={styles.thumb} src={assetUrl(hash)} alt="" loading="lazy" />;
  }
  const value = columnValue(col, row);
  if (lifecycle.kind === 'statusField' && col.key === lifecycle.field && value != null) {
    const v = String(value);
    return <Pill tone={statusTone(v)}>{v}</Pill>;
  }
  const text = formatCell(col.property, value, col.suffix);
  return text === '' ? MISSING : text;
}

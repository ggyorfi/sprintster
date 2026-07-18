import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface Column {
  key: string;
  label: string;
  width?: number;
  suffix?: string;
}

export interface TableProps {
  columns: Column[];
  rows: Array<Record<string, ReactNode>>;
  rowId?: (row: Record<string, ReactNode>) => string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onEdit?: ((id: string) => void) | undefined;
  emptyLabel?: string;
}

const defaultRowId = (row: Record<string, ReactNode>): string => String(row.id ?? '');

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M11.4 2.1l2.5 2.5L6 12.5l-3.1 0.6 0.6-3.1 7.9-7.9z" />
    </svg>
  );
}

export function Table({
  columns,
  rows,
  rowId = defaultRowId,
  selectedId,
  onSelect,
  onEdit,
  emptyLabel = 'No rows',
}: TableProps) {
  const colCount = columns.length + (onEdit !== undefined ? 1 : 0);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={styles.th} style={col.width ? { width: col.width } : undefined}>
              {col.label}
            </th>
          ))}
          {onEdit !== undefined && <th className={styles.th} aria-hidden="true" />}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={styles.empty} colSpan={colCount}>
              {emptyLabel}
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const id = rowId(row);
            const selected = selectedId !== undefined && id === selectedId;
            return (
              <tr
                key={id}
                aria-selected={selected}
                className={[styles.row, selected && styles.selected, onSelect !== undefined && styles.clickable]
                  .filter(Boolean)
                  .join(' ')}
                onClick={onSelect ? () => onSelect(id) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={styles.td}>
                    {row[col.key]}
                    {col.suffix !== undefined && row[col.key] != null && (
                      <span className={styles.suffix}>{col.suffix}</span>
                    )}
                  </td>
                ))}
                {onEdit !== undefined && (
                  <td className={[styles.td, styles.actionCell].join(' ')}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      aria-label="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(id);
                      }}
                    >
                      <EditIcon />
                    </button>
                  </td>
                )}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

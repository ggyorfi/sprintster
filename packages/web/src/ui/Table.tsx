import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface Column {
  key: string;
  label: string;
  // A number is pixels; a string is any CSS width.
  width?: number | string;
  suffix?: string;
}

export interface TableProps {
  columns: Column[];
  rows: Array<Record<string, ReactNode>>;
  rowId?: (row: Record<string, ReactNode>) => string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onEdit?: ((id: string) => void) | undefined;
  onView?: ((id: string) => void) | undefined;
  // Extra buttons per row, before view and edit.
  rowActions?: ((id: string) => ReactNode) | undefined;
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

function ViewIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
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
  onView,
  rowActions,
  emptyLabel = 'No rows',
}: TableProps) {
  const hasActions = onEdit !== undefined || onView !== undefined || rowActions !== undefined;
  const colCount = columns.length + (hasActions ? 1 : 0);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={styles.th} style={col.width ? { width: col.width } : undefined}>
              {col.label}
            </th>
          ))}
          {hasActions && <th className={styles.th} aria-hidden="true" />}
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
                {hasActions && (
                  <td className={[styles.td, styles.actionCell].join(' ')} onClick={(e) => e.stopPropagation()}>
                    {rowActions?.(id)}
                    {onView !== undefined && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        aria-label="View"
                        onClick={(e) => {
                          e.stopPropagation();
                          onView(id);
                        }}
                      >
                        <ViewIcon />
                      </button>
                    )}
                    {onEdit !== undefined && (
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
                    )}
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

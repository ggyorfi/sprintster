import { useId } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  prefix?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  readOnly?: boolean;
  disabled?: boolean;
  name?: string;
}

export function TextField({
  label,
  value = '',
  onChange,
  error,
  placeholder,
  multiline = false,
  rows = 1,
  prefix,
  type = 'text',
  inputMode,
  readOnly,
  disabled,
  name,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = error !== undefined && error !== '';
  const controlClasses = [styles.input, invalid && styles.invalid, readOnly && styles.readonly]
    .filter(Boolean)
    .join(' ');

  const shared = {
    id,
    name,
    className: controlClasses,
    value,
    placeholder,
    readOnly,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? errorId : undefined,
  } as const;

  return (
    <div className={styles.field}>
      {label !== undefined && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      <div className={styles.control}>
        {prefix !== undefined && <span className={styles.prefix}>{prefix}</span>}
        {multiline ? (
          <textarea {...shared} rows={rows} onChange={(e) => onChange?.(e.target.value)} />
        ) : (
          <input {...shared} type={type} inputMode={inputMode} onChange={(e) => onChange?.(e.target.value)} />
        )}
      </div>
      {invalid && (
        <span id={errorId} role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}

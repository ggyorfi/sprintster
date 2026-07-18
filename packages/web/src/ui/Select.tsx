import { useId } from 'react';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string | undefined;
  disabled?: boolean;
  error?: string;
}

export function Select({ label, value, onChange, options, placeholder, disabled, error }: SelectProps) {
  const id = useId();
  const invalid = error !== undefined && error !== '';
  return (
    <div className={styles.field}>
      {label !== undefined && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      <select
        id={id}
        className={[styles.select, invalid && styles.invalid].filter(Boolean).join(' ')}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {invalid && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}

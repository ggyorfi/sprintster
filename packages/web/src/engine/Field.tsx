import type { PropertyConfig, ViewFieldSpec } from '@sprintster/engine';
import { TextField, Select, type SelectOption } from '../ui/index.js';
import styles from './Field.module.css';

const MISSING = String.fromCharCode(0x2014);

export interface FieldProps {
  spec: ViewFieldSpec;
  value: string;
  onChange: (value: string) => void;
  refOptions?: SelectOption[] | undefined;
  display?: string | undefined;
}

function enumOptions(property: Extract<PropertyConfig, { type: 'enum' }>): SelectOption[] {
  return property.values.map((v) => ({ value: v, label: v }));
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readonly}>
      <span className={styles.roLabel}>{label}</span>
      <span className={styles.roValue}>{value === '' ? MISSING : value}</span>
    </div>
  );
}

export function Field({ spec, value, onChange, refOptions, display }: FieldProps) {
  const { property, label, placeholder } = spec;

  if (!spec.editable) {
    return <ReadOnlyField label={label} value={display ?? value} />;
  }

  switch (property.type) {
    case 'enum':
      return (
        <Select
          label={label}
          value={value}
          onChange={onChange}
          options={enumOptions(property)}
          placeholder={property.nullable === true ? 'none' : undefined}
        />
      );
    case 'ref':
      return (
        <Select label={label} value={value} onChange={onChange} options={refOptions ?? []} placeholder="Select..." />
      );
    case 'money':
      return (
        <TextField label={label} value={value} onChange={onChange} prefix="£" inputMode="decimal" placeholder={placeholder} />
      );
    case 'integer':
      return <TextField label={label} value={value} onChange={onChange} inputMode="numeric" placeholder={placeholder} />;
    case 'date':
      return <TextField label={label} value={value} onChange={onChange} type="date" placeholder={placeholder} />;
    default:
      return (
        <TextField
          label={label}
          value={value}
          onChange={onChange}
          multiline={spec.rows > 1}
          rows={spec.rows}
          placeholder={placeholder}
        />
      );
  }
}

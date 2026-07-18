import styles from './SearchBar.module.css';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  count?: string;
}

export function SearchBar({ value, onChange, placeholder, count }: SearchBarProps) {
  return (
    <div className={styles.bar}>
      <input
        className={styles.input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Search"
        onChange={(e) => onChange(e.target.value)}
      />
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </div>
  );
}

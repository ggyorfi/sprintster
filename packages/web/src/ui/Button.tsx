import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'neutral' | 'additive' | 'edit' | 'destructive' | 'info';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'neutral', className, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.btn, styles[variant], className].filter(Boolean).join(' ');
  return <button type={type} data-variant={variant} className={classes} {...rest} />;
}

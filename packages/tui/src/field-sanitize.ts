import type { PropertyConfig } from '@sprintster/engine';

export function sanitizeFieldInput(type: PropertyConfig['type'], next: string): string {
  switch (type) {
    case 'integer':
      return next.replace(/[^0-9]/g, '');
    case 'money': {
      const cleaned = next.replace(/[^0-9.]/g, '');
      const dot = cleaned.indexOf('.');
      if (dot === -1) return cleaned;
      const whole = cleaned.slice(0, dot);
      const frac = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
      return `${whole}.${frac}`;
    }
    case 'date':
      return next.replace(/[^0-9-]/g, '').slice(0, 10);
    default:
      return next;
  }
}

import { Button, type ButtonVariant } from './Button.js';

export default { title: 'UI/Button' };

const variants: ButtonVariant[] = ['primary', 'neutral', 'additive', 'edit', 'destructive', 'info'];

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {variants.map((v) => (
      <Button key={v} variant={v}>
        {v}
      </Button>
    ))}
  </div>
);

export const Disabled = () => (
  <Button variant="primary" disabled>
    Disabled
  </Button>
);

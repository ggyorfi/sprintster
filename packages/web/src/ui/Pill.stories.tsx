import { Pill, type PillTone } from './Pill.js';

export default { title: 'UI/Pill' };

const tones: PillTone[] = ['neutral', 'info', 'success', 'danger', 'muted'];

export const Tones = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {tones.map((t) => (
      <Pill key={t} tone={t}>
        {t}
      </Pill>
    ))}
  </div>
);

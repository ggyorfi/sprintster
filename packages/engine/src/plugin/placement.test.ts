import { describe, expect, it } from 'vitest';
import { extensionsAt } from './types.js';

describe('extensionsAt', () => {
  it('keeps the sidebar as the default place and splits off the Maintenance page ones', () => {
    const all = {
      actions: [{ id: 'p.publish', label: 'Publish', route: '/plugins/p/requests' }, { id: 'p.off', label: 'Off', route: '/plugins/p/off', placement: 'maintenance' as const }],
      badges: [{ id: 'p.status', route: '/plugins/p/status' }, { id: 'p.site', route: '/plugins/p/site', placement: 'maintenance' as const }],
    };
    expect(extensionsAt(all, 'sidebar')).toEqual({ actions: [all.actions[0]], badges: [all.badges[0]] });
    expect(extensionsAt(all, 'maintenance')).toEqual({ actions: [all.actions[1]], badges: [all.badges[1]] });
  });
});

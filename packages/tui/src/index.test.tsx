import { describe, it, expect } from 'vitest';
import { version } from '@sprintster/engine';

describe('@sprintster/tui', () => {
  it('depends on @sprintster/engine', () => {
    expect(version).toBeDefined();
  });
});

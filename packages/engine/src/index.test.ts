import { describe, it, expect } from 'vitest';
import { version } from './index.js';

describe('@sprintster/engine', () => {
  it('exposes a version', () => {
    expect(version).toBe('0.0.0');
  });
});

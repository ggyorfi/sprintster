import * as vitest from 'vitest';
import { describe, it, expect } from 'vitest';
import { describeBlobStore } from '../testing.js';
import { InMemoryBlobStore, sha256Hex } from './store.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('computes the known sha256 hex of "hello"', async () => {
    expect(await sha256Hex(enc('hello'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describeBlobStore(vitest, 'in memory', () => new InMemoryBlobStore());

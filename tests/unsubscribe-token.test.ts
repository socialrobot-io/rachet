import { describe, expect, it } from 'vitest';
import type { Config } from '../apps/server/src/config.js';
import { createUnsubscribeToken, validUnsubscribeToken } from '../apps/server/src/security/unsubscribe-token.js';

describe('unsubscribe signing keys', () => {
  it('keeps old links valid during rotation and rejects tampering', () => {
    const old = Buffer.alloc(32, 1).toString('base64');
    const next = Buffer.alloc(32, 2).toString('base64');
    const token = createUnsubscribeToken({ unsubscribeSigningKeys: [old] } as Config).token;
    expect(validUnsubscribeToken({ unsubscribeSigningKeys: [next, old] } as Config, token)).toBe(true);
    expect(validUnsubscribeToken({ unsubscribeSigningKeys: [next] } as Config, token)).toBe(false);
    expect(validUnsubscribeToken({ unsubscribeSigningKeys: [old] } as Config, `${token}x`)).toBe(false);
  });
});

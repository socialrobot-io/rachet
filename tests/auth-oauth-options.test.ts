import { describe, expect, it } from 'vitest';
import { rachetOAuthOptions } from '../apps/server/src/auth.js';
import { authorizeOperation, type Operation } from '../apps/server/src/operations.js';
import type { Config } from '../apps/server/src/config.js';
import type { OperationContext } from '../packages/contracts/src/index.js';

describe('MCP OAuth resource scopes', () => {
  it('accepts Cursor profile bootstrap without granting Rachet operation scopes', () => {
    const options = rachetOAuthOptions({ publicUrl: 'https://rachet.example.test' } as Config);

    expect(options.resourceSeedMode).toBe('merge');
    expect(options.resources).toEqual([{
      identifier: 'https://rachet.example.test/mcp',
      allowedScopes: ['profile', 'rachet:read', 'rachet:write', 'rachet:send', 'reflow:read', 'reflow:write', 'reflow:send'],
      accessTokenTtl: 900,
    }]);
  });
});

describe('legacy MCP grants', () => {
  it('keeps existing read scopes authorized after the rename', () => {
    const operation = { readOnly: true } as Operation;
    const context = { principal: { scopes: ['reflow:read'] } } as OperationContext;
    expect(() => authorizeOperation(operation, context)).not.toThrow();
  });
});

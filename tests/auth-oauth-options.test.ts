import { describe, expect, it } from 'vitest';
import { reflowOAuthOptions } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';

describe('MCP OAuth resource scopes', () => {
  it('accepts Cursor profile bootstrap without granting Rachet operation scopes', () => {
    const options = reflowOAuthOptions({ publicUrl: 'https://rachet.example.test' } as Config);

    expect(options.resourceSeedMode).toBe('merge');
    expect(options.resources).toEqual([{
      identifier: 'https://rachet.example.test/mcp',
      allowedScopes: ['profile', 'rachet:read', 'rachet:write', 'rachet:send'],
      accessTokenTtl: 900,
    }]);
  });
});

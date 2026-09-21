import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
  plugins: [magicLinkClient()],
});

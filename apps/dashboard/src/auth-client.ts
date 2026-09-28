import { magicLinkClient } from 'better-auth/client/plugins';
import { stripeClient } from '@better-auth/stripe/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
  plugins: [
    magicLinkClient(),
    stripeClient({ subscription: true }),
  ],
});

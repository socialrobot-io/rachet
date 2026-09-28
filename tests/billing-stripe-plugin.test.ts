import { describe, expect, it } from 'vitest';
import { createStripePlugin } from '../apps/server/src/billing/stripe-plugin.js';
import { loadConfig, type Config } from '../apps/server/src/config.js';

const base = {
  NODE_ENV: 'development',
  PUBLIC_URL: 'http://localhost:3000',
  TRUSTED_ORIGINS: 'http://localhost:3000',
  BETTER_AUTH_SECRET: '12345678901234567890123456789012',
};

function billingConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    ...base,
    BILLING_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
    STRIPE_PRICE_SOLO: 'price_solo',
    STRIPE_PRICE_GROWTH: 'price_growth',
    STRIPE_PRICE_SCALE: 'price_scale',
    ...overrides,
  });
}

describe('stripe plugin gating', () => {
  it('does not register the Stripe plugin when billing is off', () => {
    const config = loadConfig(base);
    expect(config.billingEnabled).toBe(false);
    expect(createStripePlugin(config, {} as never)).toBeUndefined();
  });

  it('registers the Stripe plugin when billing is on', () => {
    const plugin = createStripePlugin(billingConfig(), {} as never);
    expect(plugin).toBeDefined();
    expect(plugin?.id).toBe('stripe');
  });
});

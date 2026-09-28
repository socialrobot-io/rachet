import Stripe from 'stripe';
import type { Config } from '../config.js';

const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;

export const DEFAULT_METER_EVENT_NAME = 'rachet_contact_overage';

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

/** Report one overage contact to Stripe Billing Meters. Best-effort; never blocks admission. */
export async function reportOverageContact(input: {
  config: Pick<Config, 'stripeSecretKey' | 'stripeMeterEventName'>;
  stripeCustomerId: string;
  identifier: string;
}): Promise<void> {
  if (!input.config.stripeSecretKey) return;
  const eventName = input.config.stripeMeterEventName || DEFAULT_METER_EVENT_NAME;
  const stripe = createStripeClient(input.config.stripeSecretKey);
  await stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier: input.identifier,
    payload: {
      stripe_customer_id: input.stripeCustomerId,
      value: '1',
    },
  });
}

/** Attach the metered overage price to an active Stripe subscription if missing. */
export async function ensureOverageSubscriptionItem(input: {
  config: Pick<Config, 'stripeSecretKey' | 'stripePriceOverage'>;
  stripeSubscriptionId: string;
}): Promise<void> {
  if (!input.config.stripeSecretKey || !input.config.stripePriceOverage) return;
  const stripe = createStripeClient(input.config.stripeSecretKey);
  const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
  const already = subscription.items.data.some((item) => item.price.id === input.config.stripePriceOverage);
  if (already) return;
  await stripe.subscriptionItems.create({
    subscription: input.stripeSubscriptionId,
    price: input.config.stripePriceOverage,
  });
}

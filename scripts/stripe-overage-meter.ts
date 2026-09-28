/**
 * Create the Stripe Billing Meter and metered overage price for Rachet Cloud.
 * Run with the rachet.dev test (or live) secret key:
 *
 *   node --env-file=.env.local --import tsx scripts/stripe-overage-meter.ts
 */
import Stripe from 'stripe';

const secret = process.env.STRIPE_SECRET_KEY?.trim();
const productId = process.env.STRIPE_OVERAGE_PRODUCT_ID?.trim() || 'prod_VLGHSMKwwRYD1r';
const eventName = process.env.STRIPE_METER_EVENT_NAME?.trim() || 'rachet_contact_overage';

if (!secret) {
  console.error('STRIPE_SECRET_KEY is required');
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: '2026-08-26.dahlia' });

const existing = await stripe.billing.meters.list({ limit: 100 });
let meter = existing.data.find((row) => row.event_name === eventName && row.status === 'active');
if (!meter) {
  meter = await stripe.billing.meters.create({
    display_name: 'Rachet unique contacts overage',
    event_name: eventName,
    default_aggregation: { formula: 'sum' },
    value_settings: { event_payload_key: 'value' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
  });
  console.log('Created meter', meter.id);
} else {
  console.log('Reusing meter', meter.id);
}

const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
let price = prices.data.find((row) => row.recurring?.usage_type === 'metered' && row.recurring.meter === meter.id);
if (!price) {
  price = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    // €0.0025 per contact = €2.50 per 1,000
    unit_amount_decimal: '0.0025',
    tax_behavior: 'exclusive',
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: meter.id,
    },
    lookup_key: 'rachet_contact_overage',
    transfer_lookup_key: true,
  });
  console.log('Created metered price', price.id);
} else {
  console.log('Reusing metered price', price.id);
}

console.log(JSON.stringify({
  meterId: meter.id,
  eventName,
  priceId: price.id,
  env: {
    STRIPE_PRICE_OVERAGE: price.id,
    STRIPE_METER_EVENT_NAME: eventName,
  },
}, null, 2));

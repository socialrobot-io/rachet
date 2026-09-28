import { stripe } from '@better-auth/stripe';
import type { BetterAuthPlugin } from 'better-auth';
import type { Pool } from 'pg';
import Stripe from 'stripe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { CLOUD_PLANS, isCloudPlanName, type CloudPlanName } from './plans.js';
import { drainHeldEnrollments } from './jobs.js';
import type { Config } from '../config.js';
import * as schema from '../db/schema.js';

const ACTIVE = new Set(['active', 'trialing']);

export function createStripePlugin(config: Config, pool: Pool): BetterAuthPlugin | undefined {
  if (!config.billingEnabled) return undefined;
  if (!config.stripeSecretKey || !config.stripeWebhookSecret
    || !config.stripePriceSolo || !config.stripePriceGrowth || !config.stripePriceScale) {
    throw new Error('Billing is enabled but Stripe configuration is incomplete');
  }

  const stripeClient = new Stripe(config.stripeSecretKey, {
    apiVersion: '2026-08-26.dahlia',
  });
  const db = drizzle(pool, { schema });

  async function syncWorkspacePlan(referenceId: string, planName: string, status: string) {
    if (!referenceId) return;
    const next: CloudPlanName = ACTIVE.has(status) && isCloudPlanName(planName) && planName !== 'free'
      ? planName
      : 'free';
    await pool.query(
      `update workspaces set plan = $1, updated_at = now() where id = $2`,
      [next, referenceId],
    );
  }

  async function releaseHolds(referenceId: string) {
    await drainHeldEnrollments(db, {
      billingEnabled: true,
      stripeSecretKey: config.stripeSecretKey,
      stripeMeterEventName: config.stripeMeterEventName,
      authResendApiKey: config.authResendApiKey,
      authFrom: config.authFrom,
      publicUrl: config.publicUrl,
    }, referenceId).catch(() => undefined);
  }

  return stripe({
    stripeClient,
    stripeWebhookSecret: config.stripeWebhookSecret,
    createCustomerOnSignUp: true,
    subscription: {
      enabled: true,
      authorizeReference: async ({ user, referenceId, action }) => {
        const result = await pool.query<{ role: string }>(
          `select role from memberships where workspace_id = $1 and user_id = $2 limit 1`,
          [referenceId, user.id],
        );
        const role = result.rows[0]?.role;
        if (!role) return false;
        if (action === 'list-subscription') return true;
        return role === 'owner' || role === 'admin';
      },
      getCheckoutSessionParams: async ({ subscription }) => ({
        params: {
          automatic_tax: { enabled: true },
          tax_id_collection: { enabled: true },
          billing_address_collection: 'required' as const,
          metadata: {
            workspaceId: subscription.referenceId,
          },
        },
      }),
      onSubscriptionComplete: async ({ subscription, plan }) => {
        await syncWorkspacePlan(subscription.referenceId, plan.name, subscription.status ?? 'active');
        await releaseHolds(subscription.referenceId);
      },
      onSubscriptionUpdate: async ({ subscription }) => {
        await syncWorkspacePlan(subscription.referenceId, subscription.plan, subscription.status);
        if (ACTIVE.has(subscription.status)) await releaseHolds(subscription.referenceId);
      },
      onSubscriptionDeleted: async ({ subscription }) => {
        await syncWorkspacePlan(subscription.referenceId, 'free', 'canceled');
      },
      plans: [
        {
          name: 'solo',
          priceId: config.stripePriceSolo,
          lookupKey: 'rachet_solo_monthly',
          limits: {
            contactsPerMonth: CLOUD_PLANS.solo.contactsPerMonth,
            liveJourneys: -1,
            historyDays: CLOUD_PLANS.solo.historyDays,
          },
        },
        {
          name: 'growth',
          priceId: config.stripePriceGrowth,
          lookupKey: 'rachet_growth_monthly',
          limits: {
            contactsPerMonth: CLOUD_PLANS.growth.contactsPerMonth,
            liveJourneys: -1,
            historyDays: CLOUD_PLANS.growth.historyDays,
          },
        },
        {
          name: 'scale',
          priceId: config.stripePriceScale,
          lookupKey: 'rachet_scale_monthly',
          limits: {
            contactsPerMonth: CLOUD_PLANS.scale.contactsPerMonth,
            liveJourneys: -1,
            historyDays: CLOUD_PLANS.scale.historyDays,
          },
        },
      ],
    },
    onEvent: async (event) => {
      if (event.type === 'invoice.payment_failed') {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Stripe invoice payment failed',
          invoiceId: typeof event.data.object === 'object' && event.data.object && 'id' in event.data.object
            ? (event.data.object as { id?: string }).id
            : undefined,
        }));
      }
    },
  }) as unknown as BetterAuthPlugin;
}

/** Cloud plan limits. Keep in sync with docs/PRICING.md and apps/dashboard/src/pricing.tsx. */

export type CloudPlanName = 'free' | 'solo' | 'growth' | 'scale';

export type CloudPlanLimits = {
  name: CloudPlanName;
  /** Unique contacts enrolled per calendar month. */
  contactsPerMonth: number;
  /** Max published journeys; null means unlimited. */
  liveJourneys: number | null;
  /** Retention for finished enrollments, in days. */
  historyDays: number;
  overage: boolean;
};

export const CLOUD_PLANS: Record<CloudPlanName, CloudPlanLimits> = {
  free: { name: 'free', contactsPerMonth: 500, liveJourneys: 3, historyDays: 14, overage: false },
  solo: { name: 'solo', contactsPerMonth: 5_000, liveJourneys: null, historyDays: 90, overage: true },
  growth: { name: 'growth', contactsPerMonth: 15_000, liveJourneys: null, historyDays: 180, overage: true },
  scale: { name: 'scale', contactsPerMonth: 50_000, liveJourneys: null, historyDays: 365, overage: true },
};

export const PAID_PLAN_NAMES = ['solo', 'growth', 'scale'] as const satisfies readonly CloudPlanName[];

export function isCloudPlanName(value: string): value is CloudPlanName {
  return value in CLOUD_PLANS;
}

export function planLimits(plan: string): CloudPlanLimits {
  return isCloudPlanName(plan) ? CLOUD_PLANS[plan] : CLOUD_PLANS.free;
}

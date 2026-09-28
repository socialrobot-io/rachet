import { planLimits, type CloudPlanLimits } from './plans.js';

/** €2.50 per 1,000 contacts, in euro cents per 1,000. */
export const OVERAGE_CENTS_PER_THOUSAND = 250;

/** Paid plans continue free through this fraction past the included limit. */
export const PAID_GRACE_RATIO = 0.1;

export type UsageDecision =
  | { action: 'admit'; countsTowardUsage: false }
  | { action: 'admit'; countsTowardUsage: true; nextCount: number; asOverage: boolean; alert80: boolean; alert100: boolean }
  | { action: 'hold'; reason: 'plan_limit' | 'overage_cap'; nextCount: number };

export function currentYearMonth(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function graceContacts(limits: CloudPlanLimits): number {
  if (!limits.overage) return 0;
  return Math.floor(limits.contactsPerMonth * PAID_GRACE_RATIO);
}

export function softLimit(limits: CloudPlanLimits): number {
  return limits.contactsPerMonth + graceContacts(limits);
}

/** Overage spend for N contacts past included+grace, in euro cents (ceil to whole cents). */
export function overageCostCents(overageContacts: number): number {
  if (overageContacts <= 0) return 0;
  return Math.ceil((overageContacts / 1000) * OVERAGE_CENTS_PER_THOUSAND);
}

export function decideUsageAdmission(input: {
  plan: string;
  alreadyCountedThisMonth: boolean;
  uniqueContacts: number;
  overageEnabled: boolean;
  overageCapCents: number | null;
}): UsageDecision {
  if (input.alreadyCountedThisMonth) {
    return { action: 'admit', countsTowardUsage: false };
  }

  const limits = planLimits(input.plan);
  const nextCount = input.uniqueContacts + 1;
  const included = limits.contactsPerMonth;
  const soft = softLimit(limits);
  const alert80 = nextCount === Math.ceil(included * 0.8);
  const alert100 = nextCount === included;

  if (nextCount <= soft) {
    return {
      action: 'admit',
      countsTowardUsage: true,
      nextCount,
      asOverage: false,
      alert80,
      alert100,
    };
  }

  const planAllowsOverage = limits.overage;
  if (planAllowsOverage && input.overageEnabled) {
    const overageContacts = nextCount - soft;
    const cost = overageCostCents(overageContacts);
    if (input.overageCapCents !== null && cost > input.overageCapCents) {
      return { action: 'hold', reason: 'overage_cap', nextCount };
    }
    return {
      action: 'admit',
      countsTowardUsage: true,
      nextCount,
      asOverage: true,
      alert80: false,
      alert100: false,
    };
  }

  return { action: 'hold', reason: 'plan_limit', nextCount };
}

export function usageSummary(input: {
  plan: string;
  uniqueContacts: number;
  overageContacts: number;
  overageEnabled: boolean;
  overageCapCents: number | null;
  heldCount: number;
}) {
  const limits = planLimits(input.plan);
  return {
    yearMonth: currentYearMonth(),
    plan: limits.name,
    uniqueContacts: input.uniqueContacts,
    overageContacts: input.overageContacts,
    includedContacts: limits.contactsPerMonth,
    softLimit: softLimit(limits),
    graceContacts: graceContacts(limits),
    overageEnabled: input.overageEnabled,
    overageCapCents: input.overageCapCents,
    overageSpendCents: overageCostCents(input.overageContacts),
    heldCount: input.heldCount,
    historyDays: limits.historyDays,
    liveJourneys: limits.liveJourneys,
  };
}

import { describe, expect, it } from 'vitest';
import {
  decideUsageAdmission,
  graceContacts,
  overageCostCents,
  softLimit,
} from '../apps/server/src/billing/usage.js';
import { CLOUD_PLANS } from '../apps/server/src/billing/plans.js';

describe('unique-contact usage admission', () => {
  it('admits contacts already counted this month without growing usage', () => {
    expect(decideUsageAdmission({
      plan: 'free',
      alreadyCountedThisMonth: true,
      uniqueContacts: 500,
      overageEnabled: false,
      overageCapCents: null,
    })).toEqual({ action: 'admit', countsTowardUsage: false });
  });

  it('holds Free enrollments past the included limit with no grace', () => {
    expect(graceContacts(CLOUD_PLANS.free)).toBe(0);
    expect(softLimit(CLOUD_PLANS.free)).toBe(500);
    expect(decideUsageAdmission({
      plan: 'free',
      alreadyCountedThisMonth: false,
      uniqueContacts: 500,
      overageEnabled: false,
      overageCapCents: null,
    })).toEqual({ action: 'hold', reason: 'plan_limit', nextCount: 501 });
  });

  it('gives paid plans a 10% grace buffer before holding', () => {
    expect(graceContacts(CLOUD_PLANS.solo)).toBe(500);
    expect(softLimit(CLOUD_PLANS.solo)).toBe(5_500);
    expect(decideUsageAdmission({
      plan: 'solo',
      alreadyCountedThisMonth: false,
      uniqueContacts: 5_500,
      overageEnabled: false,
      overageCapCents: null,
    })).toEqual({ action: 'hold', reason: 'plan_limit', nextCount: 5_501 });
    expect(decideUsageAdmission({
      plan: 'solo',
      alreadyCountedThisMonth: false,
      uniqueContacts: 5_499,
      overageEnabled: false,
      overageCapCents: null,
    })).toMatchObject({ action: 'admit', asOverage: false, nextCount: 5_500 });
  });

  it('admits overage when enabled and under the spend cap', () => {
    expect(overageCostCents(1_000)).toBe(250);
    expect(decideUsageAdmission({
      plan: 'solo',
      alreadyCountedThisMonth: false,
      uniqueContacts: 5_500,
      overageEnabled: true,
      overageCapCents: 250,
    })).toMatchObject({ action: 'admit', asOverage: true, nextCount: 5_501 });
  });

  it('holds when overage would exceed the monthly spend cap', () => {
    // 1001 overage contacts => ceil(1001/1000)*250 = 500 cents
    expect(decideUsageAdmission({
      plan: 'solo',
      alreadyCountedThisMonth: false,
      uniqueContacts: 5_500 + 1_000,
      overageEnabled: true,
      overageCapCents: 250,
    })).toEqual({ action: 'hold', reason: 'overage_cap', nextCount: 6_501 });
  });

  it('emits 80% and 100% alert markers at included thresholds', () => {
    expect(decideUsageAdmission({
      plan: 'free',
      alreadyCountedThisMonth: false,
      uniqueContacts: 399,
      overageEnabled: false,
      overageCapCents: null,
    })).toMatchObject({ alert80: true, alert100: false, nextCount: 400 });
    expect(decideUsageAdmission({
      plan: 'free',
      alreadyCountedThisMonth: false,
      uniqueContacts: 499,
      overageEnabled: false,
      overageCapCents: null,
    })).toMatchObject({ alert80: false, alert100: true, nextCount: 500 });
  });
});

describe('billing maintenance gating', () => {
  it('no-ops retention purge when billing is off', async () => {
    const { purgeExpiredEnrollmentHistory } = await import('../apps/server/src/billing/jobs.js');
    await expect(purgeExpiredEnrollmentHistory({} as never, false)).resolves.toBe(0);
  });
});

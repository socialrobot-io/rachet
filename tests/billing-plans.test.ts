import { describe, expect, it } from 'vitest';
import { CLOUD_PLANS, isCloudPlanName, planLimits } from '../apps/server/src/billing/plans.js';

describe('cloud plan limits', () => {
  it('matches docs/PRICING.md contact allowances', () => {
    expect(CLOUD_PLANS.free.contactsPerMonth).toBe(500);
    expect(CLOUD_PLANS.solo.contactsPerMonth).toBe(5_000);
    expect(CLOUD_PLANS.growth.contactsPerMonth).toBe(15_000);
    expect(CLOUD_PLANS.scale.contactsPerMonth).toBe(50_000);
  });

  it('limits Free live journeys and leaves paid unrestricted', () => {
    expect(CLOUD_PLANS.free.liveJourneys).toBe(3);
    expect(CLOUD_PLANS.solo.liveJourneys).toBeNull();
    expect(CLOUD_PLANS.growth.liveJourneys).toBeNull();
    expect(CLOUD_PLANS.scale.liveJourneys).toBeNull();
  });

  it('falls back to Free for unknown plan names', () => {
    expect(isCloudPlanName('enterprise')).toBe(false);
    expect(planLimits('unknown')).toEqual(CLOUD_PLANS.free);
  });
});

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;

CREATE TABLE IF NOT EXISTS "subscription" (
  "id" text NOT NULL PRIMARY KEY,
  "plan" text NOT NULL,
  "referenceId" text NOT NULL,
  "stripeCustomerId" text,
  "stripeSubscriptionId" text,
  "status" text DEFAULT 'incomplete',
  "periodStart" timestamptz,
  "periodEnd" timestamptz,
  "trialStart" timestamptz,
  "trialEnd" timestamptz,
  "cancelAtPeriodEnd" boolean DEFAULT false,
  "cancelAt" timestamptz,
  "canceledAt" timestamptz,
  "endedAt" timestamptz,
  "seats" integer,
  "billingInterval" text,
  "stripeScheduleId" text
);

CREATE INDEX IF NOT EXISTS "subscription_referenceId_idx" ON "subscription" ("referenceId");
CREATE INDEX IF NOT EXISTS "subscription_stripeCustomerId_idx" ON "subscription" ("stripeCustomerId");

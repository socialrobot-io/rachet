ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS overage_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS overage_cap_cents integer;

ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_overage_cap_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_overage_cap_check
  CHECK (overage_cap_cents IS NULL OR overage_cap_cents >= 0);

CREATE TABLE IF NOT EXISTS workspace_usage_months (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  unique_contacts integer NOT NULL DEFAULT 0,
  overage_contacts integer NOT NULL DEFAULT 0,
  alert_80_sent_at timestamptz,
  alert_100_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, year_month),
  CONSTRAINT workspace_usage_months_year_month_check CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT workspace_usage_months_unique_contacts_check CHECK (unique_contacts >= 0),
  CONSTRAINT workspace_usage_months_overage_contacts_check CHECK (overage_contacts >= 0)
);

CREATE TABLE IF NOT EXISTS workspace_usage_contacts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, year_month, contact_id),
  CONSTRAINT workspace_usage_contacts_year_month_check CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE INDEX IF NOT EXISTS workspace_usage_contacts_month_idx
  ON workspace_usage_contacts (workspace_id, year_month);

CREATE TABLE IF NOT EXISTS held_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sequence_version_id uuid NOT NULL REFERENCES sequence_versions(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT held_enrollments_reason_check CHECK (reason IN ('plan_limit', 'overage_cap')),
  CONSTRAINT held_enrollments_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS held_enrollments_workspace_created_idx
  ON held_enrollments (workspace_id, created_at);

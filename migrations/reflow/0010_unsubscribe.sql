CREATE TABLE email_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  support_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_consents (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  consent_reference text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email_key)
);

CREATE TABLE marketing_opt_outs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  event_id text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email_key)
);

CREATE TABLE subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  event_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('consent', 'unsubscribe')),
  source text NOT NULL,
  actor_id text,
  consent_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_event_identity_unique UNIQUE (workspace_id, event_id)
);
CREATE INDEX subscription_events_address_idx ON subscription_events (workspace_id, email_key, created_at);

CREATE TABLE unsubscribe_tokens (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL UNIQUE,
  email_key text NOT NULL,
  token_digest text NOT NULL UNIQUE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE send_intents ADD COLUMN headers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sequence_versions ADD COLUMN purpose_reviewed_at timestamptz;

-- Existing suppression evidence has unknown purpose. Keep every active row as
-- a delivery block; no preference migration may silently narrow its effect.

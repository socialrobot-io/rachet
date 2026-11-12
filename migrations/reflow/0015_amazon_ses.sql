ALTER TABLE workspaces ADD COLUMN email_provider text NOT NULL DEFAULT 'resend'
  CHECK (email_provider IN ('resend', 'ses'));

CREATE TABLE ses_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  from_address text NOT NULL,
  region text NOT NULL,
  configuration_set text NOT NULL,
  topic_arn text NOT NULL,
  credentials_encrypted text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  topic_confirmed_at timestamptz,
  last_test_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE send_intents ADD COLUMN provider text NOT NULL DEFAULT 'resend'
  CHECK (provider IN ('resend', 'ses'));
ALTER TABLE send_intents ADD COLUMN feedback_topic text;

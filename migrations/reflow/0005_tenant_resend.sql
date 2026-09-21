ALTER TABLE workspaces ADD COLUMN onboarding_completed_at timestamptz;

CREATE TABLE resend_connections (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  api_key_encrypted text NOT NULL,
  api_key_fingerprint text NOT NULL UNIQUE,
  webhook_secret_encrypted text NOT NULL,
  webhook_secret_fingerprint text NOT NULL UNIQUE,
  from_address text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  last_test_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE send_intents ADD COLUMN connection_version integer;
ALTER TABLE send_intents ADD COLUMN from_address text;
ALTER TABLE webhook_events ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
DROP INDEX webhook_event_unique;
CREATE UNIQUE INDEX webhook_event_workspace_unique ON webhook_events(workspace_id, provider, event_id);
CREATE UNIQUE INDEX webhook_event_legacy_unique ON webhook_events(provider, event_id) WHERE workspace_id IS NULL;

-- A referenced row's UUID alone must never be enough to cross an organization boundary.
CREATE UNIQUE INDEX contacts_workspace_id_unique ON contacts(workspace_id, id);
CREATE UNIQUE INDEX sequence_versions_workspace_id_unique ON sequence_versions(workspace_id, id);
CREATE UNIQUE INDEX enrollments_workspace_id_unique ON enrollments(workspace_id, id);
CREATE UNIQUE INDEX templates_workspace_id_unique ON templates(workspace_id, id);
CREATE UNIQUE INDEX sequences_workspace_id_unique ON sequences(workspace_id, id);
ALTER TABLE enrollments ADD CONSTRAINT enrollment_contact_workspace_fk
  FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts(workspace_id, id);
ALTER TABLE enrollments ADD CONSTRAINT enrollment_version_workspace_fk
  FOREIGN KEY (workspace_id, sequence_version_id) REFERENCES sequence_versions(workspace_id, id);
ALTER TABLE send_intents ADD CONSTRAINT send_intent_enrollment_workspace_fk
  FOREIGN KEY (workspace_id, enrollment_id) REFERENCES enrollments(workspace_id, id);
ALTER TABLE enrollment_events ADD CONSTRAINT enrollment_event_workspace_fk
  FOREIGN KEY (workspace_id, enrollment_id) REFERENCES enrollments(workspace_id, id);
ALTER TABLE template_versions ADD CONSTRAINT template_version_workspace_fk
  FOREIGN KEY (workspace_id, template_id) REFERENCES templates(workspace_id, id);
ALTER TABLE sequence_versions ADD CONSTRAINT sequence_version_workspace_fk
  FOREIGN KEY (workspace_id, sequence_id) REFERENCES sequences(workspace_id, id);

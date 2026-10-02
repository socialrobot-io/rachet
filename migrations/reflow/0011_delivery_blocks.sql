CREATE TABLE delivery_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  event_id text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_block_event_unique UNIQUE (workspace_id, event_id)
);
CREATE INDEX delivery_block_address_idx ON delivery_blocks (workspace_id, email_key);

-- Existing active suppressions have no trustworthy purpose. Preserve each as
-- a delivery block with its original reason, source, and timestamp.
INSERT INTO delivery_blocks (workspace_id, email_key, event_id, reason, source, created_at)
SELECT workspace_id, email_key, 'legacy:' || id::text, reason, source, created_at
FROM suppressions WHERE active = true;

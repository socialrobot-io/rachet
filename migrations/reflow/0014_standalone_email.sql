ALTER TABLE send_intents
  ALTER COLUMN enrollment_id DROP NOT NULL,
  ADD COLUMN standalone_purpose text,
  ADD CONSTRAINT send_intents_source_check CHECK (
    (enrollment_id IS NOT NULL AND standalone_purpose IS NULL)
    OR (enrollment_id IS NULL AND standalone_purpose IS NOT NULL
        AND standalone_purpose IN ('transactional', 'marketing'))
  );

CREATE INDEX send_intents_standalone_workspace_idx
  ON send_intents (workspace_id, created_at)
  WHERE enrollment_id IS NULL;

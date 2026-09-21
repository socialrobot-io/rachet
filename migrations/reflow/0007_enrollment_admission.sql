CREATE INDEX enrollments_workspace_created_idx ON enrollments(workspace_id, created_at);
CREATE INDEX enrollments_workspace_state_idx ON enrollments(workspace_id, state);

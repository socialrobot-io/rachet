ALTER TABLE workspaces ADD COLUMN plan text NOT NULL DEFAULT 'free';
ALTER TABLE workspaces ADD CONSTRAINT workspaces_plan_check CHECK (plan IN ('free', 'solo', 'growth', 'scale'));

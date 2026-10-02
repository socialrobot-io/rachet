ALTER TABLE unsubscribe_tokens ADD COLUMN origin jsonb;
ALTER TABLE subscription_events ADD COLUMN origin jsonb;

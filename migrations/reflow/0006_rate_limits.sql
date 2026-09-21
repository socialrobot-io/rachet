CREATE TABLE rate_limit_buckets (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limit_buckets_reset_idx ON rate_limit_buckets(reset_at);

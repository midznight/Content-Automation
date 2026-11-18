CREATE TABLE IF NOT EXISTS agent_dispatches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'sending', 'dispatched', 'retry', 'awaiting_config', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  dispatched_at TEXT,
  external_request_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_dispatches_status_due
  ON agent_dispatches(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_agent_dispatches_last_attempt
  ON agent_dispatches(status, last_attempt_at);

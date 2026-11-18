ALTER TABLE videos ADD COLUMN updated_at TEXT;
ALTER TABLE approvals ADD COLUMN summary TEXT;
ALTER TABLE approvals ADD COLUMN requested_by TEXT;

CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    video_id TEXT NOT NULL REFERENCES videos(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    expected_size INTEGER NOT NULL CHECK (expected_size > 0),
    expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256) = 64),
    object_key TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'uploading', 'uploaded', 'registered', 'failed')),
    sha256 TEXT,
    size_bytes INTEGER,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_task ON upload_sessions(task_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry ON upload_sessions(status, expires_at);

ALTER TABLE artifacts ADD COLUMN upload_id TEXT REFERENCES upload_sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_upload_id ON artifacts(upload_id) WHERE upload_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS artifact_access_tokens (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_access_tokens_artifact ON artifact_access_tokens(artifact_id, used_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(decision, requested_at);

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

ALTER TABLE videos ADD COLUMN updated_at TEXT;
ALTER TABLE approvals ADD COLUMN summary TEXT;
ALTER TABLE approvals ADD COLUMN requested_by TEXT;
ALTER TABLE upload_sessions ADD COLUMN expected_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE artifacts ADD COLUMN upload_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_upload_id ON artifacts(upload_id) WHERE upload_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS artifact_access_tokens (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_access_tokens_lookup
    ON artifact_access_tokens(artifact_id, token_hash, used_at);
CREATE INDEX IF NOT EXISTS idx_artifact_access_tokens_expiry
    ON artifact_access_tokens(used_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_task ON upload_sessions(task_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry ON upload_sessions(status, expires_at);
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

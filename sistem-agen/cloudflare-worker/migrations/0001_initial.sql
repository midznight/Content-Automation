CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT 'manual',
    key_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agents_role_active ON agents(role, active);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    pillar TEXT,
    stage TEXT NOT NULL DEFAULT 'topic',
    label_ai INTEGER NOT NULL DEFAULT 0 CHECK (label_ai IN (0, 1)),
    created_at TEXT NOT NULL,
    published_at TEXT,
    tiktok_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_stage ON videos(stage);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    video_id TEXT REFERENCES videos(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    priority TEXT NOT NULL DEFAULT 'normal',
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    blocked_reason TEXT,
    result TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    reassigned_from TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    updated_at TEXT NOT NULL,
    due_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_to_status_created ON tasks(to_agent, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_from_created ON tasks(from_agent, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_video ON tasks(video_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    video_id TEXT REFERENCES videos(id),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_video ON artifacts(video_id);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id),
    stage TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decision TEXT,
    decided_by TEXT,
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_video_stage ON approvals(video_id, stage);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    task_id TEXT,
    video_id TEXT,
    detail TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor);
CREATE INDEX IF NOT EXISTS idx_events_action_ts ON events(action, ts);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id),
    captured_at TEXT NOT NULL,
    window TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    avg_watch_pct REAL NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    follows INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_metrics_video_captured ON metrics(video_id, captured_at);

CREATE TABLE IF NOT EXISTS rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL
);
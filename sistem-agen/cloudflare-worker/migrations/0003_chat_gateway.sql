CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_chat_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, external_chat_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  task_id TEXT REFERENCES tasks(id),
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'system')),
  actor TEXT NOT NULL,
  role TEXT,
  message_text TEXT NOT NULL,
  external_chat_id TEXT,
  external_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_telegram_dedupe
  ON chat_messages(external_chat_id, external_message_id)
  WHERE direction = 'inbound' AND external_chat_id IS NOT NULL AND external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_task ON chat_messages(task_id);

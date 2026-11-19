-- Consolidate active identities into the Muse App architecture.
-- API key hashes are intentionally preserved so each existing Muse Custom
-- Connector continues to authenticate with its own per-agent credential.
--
-- Account mapping:
--   muse-strategist      -> muse-controller / ceo
--   muse-social          -> muse-animator-primary / animator
--   muse-animator-backup -> unchanged / animator_backup
--
-- Legacy Cue and unused Muse specialists are disabled, not deleted.

UPDATE agents
SET active = 0
WHERE name IN (
  'cue-ceo',
  'cue-animator',
  'muse-fact-checker',
  'muse-analyst'
)
AND active = 1;

UPDATE agents
SET name = 'muse-controller',
    role = 'ceo',
    vendor = 'muse'
WHERE name = 'muse-strategist'
  AND role = 'strategist'
  AND vendor = 'muse'
  AND active = 1;

UPDATE agents
SET name = 'muse-animator-primary',
    role = 'animator',
    vendor = 'muse'
WHERE name = 'muse-social'
  AND role = 'social'
  AND vendor = 'muse'
  AND active = 1;

INSERT INTO events (ts, actor, action, detail)
VALUES (
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'system',
  'muse_three_agent_migration',
  '{"controller":"muse-controller","animator_primary":"muse-animator-primary","animator_backup":"muse-animator-backup","disabled":["cue-ceo","cue-animator","muse-fact-checker","muse-analyst"]}'
);

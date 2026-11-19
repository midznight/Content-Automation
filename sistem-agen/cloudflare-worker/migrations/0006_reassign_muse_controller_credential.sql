-- Reassign the active Muse Controller identity to the credential previously
-- used by muse-analyst, following explicit owner approval.
-- The former strategist-derived Controller credential is retained inactive.
-- Applied to production D1 on 2026-11-19. Safe to re-run.

UPDATE agents
SET name = 'muse-controller-legacy',
    active = 0
WHERE name = 'muse-controller'
  AND role = 'ceo'
  AND vendor = 'muse'
  AND active = 1
  AND EXISTS (
    SELECT 1 FROM agents
    WHERE name = 'muse-analyst'
      AND role = 'analyst'
      AND vendor = 'muse'
      AND active = 0
  );

UPDATE agents
SET name = 'muse-controller',
    role = 'ceo',
    vendor = 'muse',
    active = 1
WHERE name = 'muse-analyst'
  AND role = 'analyst'
  AND vendor = 'muse'
  AND active = 0
  AND EXISTS (
    SELECT 1 FROM agents
    WHERE name = 'muse-controller-legacy'
      AND role = 'ceo'
      AND vendor = 'muse'
      AND active = 0
  );

INSERT INTO events (ts, actor, action, detail)
SELECT
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'system',
  'muse_controller_credential_reassigned',
  '{"from":"muse-analyst","to":"muse-controller","preserved_legacy":"muse-controller-legacy","approved_by":"owner","date":"2026-11-19"}'
WHERE NOT EXISTS (
  SELECT 1 FROM events
  WHERE action = 'muse_controller_credential_reassigned'
    AND detail = '{"from":"muse-analyst","to":"muse-controller","preserved_legacy":"muse-controller-legacy","approved_by":"owner","date":"2026-11-19"}'
);

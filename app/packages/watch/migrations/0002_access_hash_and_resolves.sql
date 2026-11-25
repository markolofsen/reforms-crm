-- P153 (plan D4): a restart costs no username resolve. The account's client keeps no peers across a restart (mtcute
-- MemoryStorage), so the watch file keeps each group's channel access hash beside its peer id, and the day's resolve count.
-- An access hash is bound to the account that resolved it; a stale one (CHANNEL_INVALID) falls back to one resolve.

ALTER TABLE groups ADD COLUMN access_hash TEXT;

CREATE TABLE resolve_days (
  project TEXT NOT NULL,
  -- UTC day, YYYY-MM-DD.
  day TEXT NOT NULL,
  resolves INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, day)
);

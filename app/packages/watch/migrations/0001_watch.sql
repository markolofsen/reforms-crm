-- P144 W3: the watcher's own database, one file per project (`data/watch/<slug>.db`, research 26 section 1.5). It is not app.db:
-- a failing migration here stops that project's watcher, never the server. Every table carries `project` (rules README 11).
-- Retention (verdict 12): `messages` is a cache kept 30 days; a moment keeps its author fields 180 days, then they are blanked;
-- windows and `group_days` hold no person and stay. Watched people never become `clients` rows (rules README 16).

CREATE TABLE groups (
  project TEXT NOT NULL,
  username TEXT NOT NULL,
  title TEXT,
  -- Telegram's peer id, cached after the one resolve (verdict 11: at most 20 resolves a day).
  peer_id TEXT,
  -- unknown (not resolved yet), open (read without joining), join_required, pending (a join request waits for an admin),
  -- joined, refused (Telegram refused it, the reason in park_reason).
  access TEXT NOT NULL DEFAULT 'unknown' CHECK (access IN ('unknown', 'open', 'join_required', 'pending', 'joined', 'refused')),
  last_message_id INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT,
  parked_until TEXT,
  park_reason TEXT,
  new_since_analysis INTEGER NOT NULL DEFAULT 0,
  last_analysis_at TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (project, username)
);

CREATE TABLE messages (
  project TEXT NOT NULL,
  group_username TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  sender_id TEXT,
  sender_handle TEXT,
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  PRIMARY KEY (project, group_username, message_id)
);
CREATE INDEX messages_by_time ON messages (project, group_username, sent_at, message_id);

-- What one window of one group said as a whole: no person.
CREATE TABLE windows (
  project TEXT NOT NULL,
  window_key TEXT NOT NULL,
  group_username TEXT NOT NULL,
  first_message_id INTEGER NOT NULL,
  last_message_id INTEGER NOT NULL,
  messages INTEGER NOT NULL,
  task_version INTEGER NOT NULL,
  model TEXT,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  topics TEXT NOT NULL DEFAULT '[]',
  mood TEXT,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  analysed_at TEXT NOT NULL,
  PRIMARY KEY (project, window_key)
);
CREATE INDEX windows_by_time ON windows (project, last_at);

-- One kept moment: a person voicing a trigger in a public group. The author fields are blanked after 180 days.
CREATE TABLE moments (
  project TEXT NOT NULL,
  group_username TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  trigger_other TEXT NOT NULL DEFAULT '',
  intensity INTEGER NOT NULL,
  quote TEXT NOT NULL,
  author_id TEXT,
  author_handle TEXT,
  reactors INTEGER NOT NULL DEFAULT 0,
  reactor_handles TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  window_key TEXT NOT NULL,
  at TEXT NOT NULL,
  blanked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, group_username, message_id, trigger)
);
CREATE INDEX moments_by_time ON moments (project, at);

-- Messages stored per group per UTC day: kept after the messages themselves expire, for the Groups view's rate.
CREATE TABLE group_days (
  project TEXT NOT NULL,
  group_username TEXT NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, group_username, day)
);

-- Membership is independent of whether public history can be read.
CREATE TABLE memberships (
  project TEXT NOT NULL,
  account TEXT NOT NULL,
  group_username TEXT NOT NULL,
  peer_id TEXT,
  kind TEXT,
  state TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT,
  joined_at TEXT,
  queued_at TEXT,
  next_attempt_at TEXT,
  attempted_at TEXT,
  reason TEXT,
  generation TEXT,
  request_ref TEXT,
  PRIMARY KEY (project, account, group_username)
);
CREATE TABLE membership_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  account TEXT NOT NULL,
  group_username TEXT NOT NULL,
  at TEXT NOT NULL,
  state TEXT NOT NULL,
  generation TEXT,
  request_ref TEXT,
  reason TEXT
);
CREATE INDEX membership_due ON memberships(project, account, state, next_attempt_at);
CREATE INDEX membership_events_project ON membership_events(project, at);

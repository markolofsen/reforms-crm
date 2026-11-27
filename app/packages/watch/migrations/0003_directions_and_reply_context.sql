-- Source messages and polling are shared; only analysis belongs to a direction.
ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER;
ALTER TABLE messages ADD COLUMN thread_id INTEGER;

CREATE TABLE windows_next (
  project TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'default', window_key TEXT NOT NULL,
  group_username TEXT NOT NULL, first_message_id INTEGER NOT NULL, last_message_id INTEGER NOT NULL,
  messages INTEGER NOT NULL, task_version INTEGER NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  topics TEXT NOT NULL DEFAULT '[]', mood TEXT, first_at TEXT NOT NULL, last_at TEXT NOT NULL, analysed_at TEXT NOT NULL,
  PRIMARY KEY (project, direction, window_key)
);
INSERT INTO windows_next SELECT project, 'default', window_key, group_username, first_message_id, last_message_id,
  messages, task_version, model, cost_micro_usd, topics, mood, first_at, last_at, analysed_at FROM windows;
DROP TABLE windows;
ALTER TABLE windows_next RENAME TO windows;
CREATE INDEX windows_group_direction ON windows(project, direction, group_username, last_message_id);

CREATE TABLE moments_next (
  project TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'default', group_username TEXT NOT NULL, message_id INTEGER NOT NULL,
  trigger TEXT NOT NULL, trigger_other TEXT NOT NULL DEFAULT '', intensity INTEGER NOT NULL, quote TEXT NOT NULL,
  author_id TEXT, author_handle TEXT, reactors INTEGER NOT NULL DEFAULT 0, reactor_handles TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '', window_key TEXT NOT NULL, at TEXT NOT NULL,
  blanked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (project, direction, group_username, message_id, trigger)
);
INSERT INTO moments_next SELECT project, 'default', group_username, message_id, trigger, trigger_other, intensity, quote,
  author_id, author_handle, reactors, reactor_handles, context, why, window_key, at, blanked FROM moments;
DROP TABLE moments;
ALTER TABLE moments_next RENAME TO moments;
CREATE INDEX moments_direction_time ON moments(project, direction, at);

CREATE TABLE analysis_state (
  project TEXT NOT NULL, direction TEXT NOT NULL, group_username TEXT NOT NULL, last_analysis_at TEXT,
  processed_through INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, direction, group_username)
);
INSERT INTO analysis_state (project,direction,group_username,last_analysis_at) SELECT project, 'default', username, last_analysis_at FROM groups;

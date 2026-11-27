CREATE TABLE watch_public_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  project TEXT NOT NULL,
  direction TEXT NOT NULL,
  account TEXT NOT NULL,
  group_username TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  access_hash TEXT,
  reply_to_message_id INTEGER NOT NULL,
  thread_id INTEGER,
  target_key TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_at TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  policy_generation TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  strategy_hash TEXT NOT NULL,
  review_ref TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  random_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX watch_public_proposals_project_created ON watch_public_proposals(project, created_at);
--> statement-breakpoint
ALTER TABLE send_log ADD COLUMN public_proposal_id TEXT REFERENCES watch_public_proposals(id);
--> statement-breakpoint
ALTER TABLE send_log ADD COLUMN public_target_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX send_log_public_proposal ON send_log(public_proposal_id) WHERE public_proposal_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX send_log_public_target_live ON send_log(public_target_key) WHERE public_target_key IS NOT NULL AND status IN ('queued','sending','sent');

--> statement-breakpoint
CREATE TRIGGER live_watch_public_proposals_ai AFTER INSERT ON watch_public_proposals BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_proposals', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER live_watch_public_proposals_au AFTER UPDATE ON watch_public_proposals BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_proposals', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_proposals', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER live_watch_public_proposals_ad AFTER DELETE ON watch_public_proposals BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_proposals', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

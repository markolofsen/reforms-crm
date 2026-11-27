ALTER TABLE watch_public_proposals ADD COLUMN payload_hash TEXT;
--> statement-breakpoint
ALTER TABLE watch_public_proposals ADD COLUMN photo TEXT;
--> statement-breakpoint
CREATE INDEX watch_public_proposals_source ON watch_public_proposals(project, direction, group_username, account, chat_id, reply_to_message_id, created_at);
--> statement-breakpoint
CREATE TABLE watch_public_photos (
  proposal_id TEXT PRIMARY KEY NOT NULL REFERENCES watch_public_proposals(id),
  project TEXT NOT NULL,
  account TEXT NOT NULL,
  asset_hash TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  access_hash TEXT NOT NULL,
  file_reference TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER live_watch_public_photos_ai AFTER INSERT ON watch_public_photos BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_photos', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER live_watch_public_photos_au AFTER UPDATE ON watch_public_photos BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_photos', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_photos', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER live_watch_public_photos_ad AFTER DELETE ON watch_public_photos BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'watch_public_photos', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

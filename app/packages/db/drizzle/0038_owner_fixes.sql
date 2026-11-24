-- Hand-written (P133, P129 verdict 11): a refusal of `hub mcp` only the owner can fix, one row per project and code, shown on
-- Overview's Needs you until the tool's next successful call or for 24 hours. Additive only: a running instance keeps working
-- on the old code until it restarts.
CREATE TABLE `owner_fixes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`code` text NOT NULL,
	`tool` text NOT NULL,
	`line` text NOT NULL,
	`place` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_fixes_key` ON `owner_fixes` (`project`,`code`);--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_owner_fixes_ai` AFTER INSERT ON `owner_fixes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'owner_fixes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_owner_fixes_au` AFTER UPDATE ON `owner_fixes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'owner_fixes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'owner_fixes', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_owner_fixes_ad` AFTER DELETE ON `owner_fixes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'owner_fixes', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

-- Hand-written (P65 S1, decision 0031): the Mail versions the Hub wrote, so a Mail draft's authorship is the Hub's
-- record, never a line in its text. Three live triggers like every table (0019); its topic is `mail`.
CREATE TABLE `mail_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`mail_ref` text NOT NULL,
	`draft_id` integer,
	`account` text NOT NULL,
	`mail_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`hash` text NOT NULL,
	`source` text NOT NULL,
	`signature_fallback` text,
	`written_at` text NOT NULL,
	`trashed_at` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mail_versions_project_ref` ON `mail_versions` (`project`,`mail_ref`);--> statement-breakpoint
CREATE INDEX `mail_versions_draft` ON `mail_versions` (`draft_id`);--> statement-breakpoint
CREATE TRIGGER `live_mail_versions_ai` AFTER INSERT ON `mail_versions` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_versions', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_mail_versions_au` AFTER UPDATE ON `mail_versions` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_versions', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_versions', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_mail_versions_ad` AFTER DELETE ON `mail_versions` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_versions', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

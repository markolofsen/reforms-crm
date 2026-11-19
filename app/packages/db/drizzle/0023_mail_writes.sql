-- Hand-written (P65 S5, decision 0031 addendum): the Mail writes the Hub started, recorded before each save, so a draft
-- Mail saves after the writer stopped waiting is still known as the Hub's (by the hash of its text, never the text).
-- Three live triggers like every table (0019); its topic is `mail`.
CREATE TABLE `mail_writes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`mail_ref` text NOT NULL,
	`draft_id` integer,
	`text_hash` text NOT NULL,
	`text_len` integer NOT NULL,
	`shell_hash` text,
	`started_at` text NOT NULL,
	`settled_at` text,
	`mail_id` integer,
	`message_id` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mail_writes_project_ref` ON `mail_writes` (`project`,`mail_ref`);--> statement-breakpoint
CREATE TRIGGER `live_mail_writes_ai` AFTER INSERT ON `mail_writes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_writes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_mail_writes_au` AFTER UPDATE ON `mail_writes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_writes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_writes', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_mail_writes_ad` AFTER DELETE ON `mail_writes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'mail_writes', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

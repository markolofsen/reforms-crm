-- Hand-written (P96 S1): the Mail reader. One row per inbound message the server judged a client's (a reply in a thread the
-- Hub knows, a known client, or the owner's test address in test mode). No body (decision 0013): a preview of at most 120
-- characters of the client's own text. `dismissed_at` is the owner's No reply needed (Undo clears it). Never deleted by the reader.
CREATE TABLE `inbound_mail` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`account` text NOT NULL,
	`mailbox` text NOT NULL,
	`message_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`why` text NOT NULL CHECK (`why` IN ('thread', 'client', 'test')),
	`thread_draft_id` integer REFERENCES `drafts`(`id`) ON DELETE set null,
	`thread_ref` text,
	`preview` text DEFAULT '' NOT NULL,
	`dismissed_at` text,
	`stored_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_mail_project_message` ON `inbound_mail` (`project`,`message_id`);--> statement-breakpoint
CREATE INDEX `inbound_mail_project_email` ON `inbound_mail` (`project`,`email`,`received_at`);--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_inbound_mail_ai` AFTER INSERT ON `inbound_mail` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'inbound_mail', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_inbound_mail_au` AFTER UPDATE ON `inbound_mail` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'inbound_mail', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'inbound_mail', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_inbound_mail_ad` AFTER DELETE ON `inbound_mail` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'inbound_mail', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

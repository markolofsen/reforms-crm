-- Hand-written (P71 M-P, decision 0039): the pre-analysis' verdict on one stored inbound message of a linked chat whose `prefilter`
-- is on. One row per message, deleted with its message (ON DELETE CASCADE: the retention purge and unlinking a chat take it along).
-- A label and the model only: no summary, no text. The verdict list is `TRIAGE_VERDICTS` of `@hub/config/chat-rules`.
CREATE TABLE `messenger_triage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`message_id` integer NOT NULL REFERENCES `messenger_messages`(`id`) ON DELETE cascade,
	`verdict` text NOT NULL CHECK (`verdict` IN ('needs_reply', 'unclear', 'fyi', 'closing', 'automated', 'personal', 'unjudged')),
	`model` text,
	`prompt_version` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messenger_triage_message` ON `messenger_triage` (`message_id`);--> statement-breakpoint
CREATE INDEX `messenger_triage_project` ON `messenger_triage` (`project`,`verdict`);--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_messenger_triage_ai` AFTER INSERT ON `messenger_triage` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_triage', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_messenger_triage_au` AFTER UPDATE ON `messenger_triage` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_triage', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_triage', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_messenger_triage_ad` AFTER DELETE ON `messenger_triage` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_triage', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

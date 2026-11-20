-- Hand-written (P84, decision 0036 point 3 as amended 2026-11-20): "never link this chat". The Hub's autolink skips a chat whose
-- HMAC-SHA256 (of project, channel and chat id, keyed by a file under state/secrets) is here. Only the hash is kept, never the chat.
CREATE TABLE `messenger_link_refusals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`channel` text NOT NULL,
	`hash` text NOT NULL CHECK (length(`hash`) = 64),
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `messenger_link_refusals_key` ON `messenger_link_refusals` (`project`,`channel`,`hash`);--> statement-breakpoint
-- Who linked a chat: null for the owner's Link, else the reason of the Hub's autolink ("phone matches the client"). ADD COLUMN
-- keeps the live_messenger_chats_* triggers of 0019.
ALTER TABLE `messenger_chats` ADD `autolinked` text;--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_messenger_link_refusals_ai` AFTER INSERT ON `messenger_link_refusals` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_link_refusals', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_messenger_link_refusals_au` AFTER UPDATE ON `messenger_link_refusals` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_link_refusals', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_link_refusals', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_messenger_link_refusals_ad` AFTER DELETE ON `messenger_link_refusals` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'messenger_link_refusals', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

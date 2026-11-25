-- Hand-written (decision 0050, P142 F1): the daily follow-up sweep. `follow_ups` is one plan per client per project, the agent's
-- notes (verdict 3: nothing refuses because of it); `follow_up_sweeps` is one row per sweep, so "last swept" and the day's turn
-- budget survive a restart. Three live triggers each, like every table (0019). The new columns are additive only (ADD COLUMN, no
-- table rebuild), so the live_drafts_*, live_messenger_drafts_* and live_messenger_chats_* triggers of 0019 and their indexes stay
-- as they are (rule 16): `follow_up_n` marks a nudge draft and its number, `last_outbound_at` mirrors `last_inbound_at`.
-- Backfill (verdict 14): `last_outbound_at` from the sent messenger rows of `send_log` and the cache's outbound rows; no plan is
-- invented (the first sweep writes each one).
CREATE TABLE `follow_ups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	`state` text NOT NULL CHECK (`state` IN ('waiting', 'stopped', 'handed_over', 'answered')),
	`next_at` text,
	`waiting_on` text CHECK (`waiting_on` IS NULL OR `waiting_on` IN ('them', 'us')),
	`nudges_sent` integer DEFAULT 0 NOT NULL,
	`last_nudge_at` text,
	`channel` text CHECK (`channel` IS NULL OR `channel` IN ('mail', 'telegram_user', 'telegram_bot', 'whatsapp')),
	`reason` text CHECK (`reason` IS NULL OR length(`reason`) <= 200),
	`stop_reason` text CHECK (`stop_reason` IS NULL OR `stop_reason` IN ('no_answer', 'not_interested', 'lost', 'done', 'do_not_contact')),
	`tz` text,
	`line` text CHECK (`line` IS NULL OR length(`line`) <= 160),
	`decided_by` text NOT NULL CHECK (`decided_by` IN ('agent', 'owner')),
	`decided_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_ups_client` ON `follow_ups` (`project`, `client_id`);
--> statement-breakpoint
CREATE INDEX `follow_ups_due` ON `follow_ups` (`project`, `state`, `next_at`);
--> statement-breakpoint
CREATE TABLE `follow_up_sweeps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`trigger` text NOT NULL CHECK (`trigger` IN ('schedule', 'button', 'catch_up')),
	`started_at` text NOT NULL,
	`finished_at` text,
	`listed` integer DEFAULT 0 NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`nudged` integer DEFAULT 0 NOT NULL,
	`waited` integer DEFAULT 0 NOT NULL,
	`stopped` integer DEFAULT 0 NOT NULL,
	`handed_over` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `follow_up_sweeps_project` ON `follow_up_sweeps` (`project`, `started_at`);
--> statement-breakpoint
CREATE TRIGGER `live_follow_ups_ai` AFTER INSERT ON `follow_ups` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_ups', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_follow_ups_au` AFTER UPDATE ON `follow_ups` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_ups', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_ups', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_follow_ups_ad` AFTER DELETE ON `follow_ups` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_ups', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_follow_up_sweeps_ai` AFTER INSERT ON `follow_up_sweeps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_up_sweeps', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_follow_up_sweeps_au` AFTER UPDATE ON `follow_up_sweeps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_up_sweeps', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_up_sweeps', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_follow_up_sweeps_ad` AFTER DELETE ON `follow_up_sweeps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'follow_up_sweeps', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
ALTER TABLE `drafts` ADD `follow_up_n` integer;
--> statement-breakpoint
ALTER TABLE `messenger_drafts` ADD `follow_up_n` integer;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `last_outbound_at` text;
--> statement-breakpoint
UPDATE `messenger_chats` SET `last_outbound_at` = (
  SELECT max(x) FROM (
    SELECT s.`done_at` AS x FROM `send_log` s WHERE s.`project` = `messenger_chats`.`project` AND s.`channel` = `messenger_chats`.`channel` AND s.`status` = 'sent' AND s.`to_addr` = (CASE WHEN `messenger_chats`.`channel` = 'whatsapp' THEN 'whatsapp:' ELSE 'telegram:' END) || `messenger_chats`.`chat_id`
    UNION ALL
    SELECT m.`sent_at` AS x FROM `messenger_messages` m WHERE m.`project` = `messenger_chats`.`project` AND m.`channel` = `messenger_chats`.`channel` AND m.`chat_id` = `messenger_chats`.`chat_id` AND m.`direction` = 'out'
  )
);

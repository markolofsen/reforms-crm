-- Hand-written (decision 0055, P147 L1): the daily lead pass. `lead_passes` is one row per pass, so "last pass" and the day's
-- turn budget survive a restart (verdict 4). The lead's decision lives on its `lead_rows` row (verdict 2, D3, D7): the agent's
-- notes, never a gate. ADD COLUMN only, no table rebuild, so the live_lead_rows_* and live_drafts_* triggers and their indexes
-- stay as they are (rule 16). `drafts.served_hash` (D10) is the hash of the text the lead review served, set by the server at
-- that read; the ticket's Checked takes it, never a hash the browser sent. `batches.intent` has no CHECK (0004), so
-- `lead_reply` needs no change here. No backfill: the first pass writes each decision.
CREATE TABLE `lead_passes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`trigger` text NOT NULL CHECK (`trigger` IN ('schedule', 'button', 'catch_up', 'dock')),
	`started_at` text NOT NULL,
	`finished_at` text,
	`listed` integer DEFAULT 0 NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`replied` integer DEFAULT 0 NOT NULL,
	`clients` integer DEFAULT 0 NOT NULL,
	`spam` integer DEFAULT 0 NOT NULL,
	`not_now` integer DEFAULT 0 NOT NULL,
	`handed_over` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`batch_id` integer REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE set null,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `lead_passes_project` ON `lead_passes` (`project`, `started_at`);
--> statement-breakpoint
CREATE TRIGGER `live_lead_passes_ai` AFTER INSERT ON `lead_passes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_passes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_lead_passes_au` AFTER UPDATE ON `lead_passes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_passes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_passes', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_lead_passes_ad` AFTER DELETE ON `lead_passes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_passes', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_decision` text CHECK (`pass_decision` IS NULL OR `pass_decision` IN ('reply', 'client', 'spam', 'not_now', 'hand_over'));
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_reason` text CHECK (`pass_reason` IS NULL OR length(`pass_reason`) <= 200);
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_at` text;
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_id` integer REFERENCES `lead_passes`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_draft_id` integer REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_client_id` integer REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `pass_excluded_at` text;
--> statement-breakpoint
CREATE INDEX `lead_rows_project_pass` ON `lead_rows` (`project`, `pass_decision`);
--> statement-breakpoint
ALTER TABLE `drafts` ADD `served_hash` text;

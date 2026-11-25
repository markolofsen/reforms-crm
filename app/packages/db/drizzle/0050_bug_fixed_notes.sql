-- Hand-written (P145 B4 in P147 3m item 6, approved 2026-11-25): closing the loop on a fixed bug. One row per (report, client):
-- the follow-up sweep found a Bug report with Status Fixed and an empty `Client told` linked to this client, and a turn wrote the
-- short "fixed, please check" note (its mail draft, which joins the day's lead batch, or its messenger draft). `told_at` is the
-- send's time, set at the send; `notion_told_at` once Notion's `Client told` was written (when every linked client was told). The
-- row is what keeps the sweep from drafting the same note again, whatever happened to the draft. A new table, so its three
-- live_* triggers (rule 16); nothing else changes.
CREATE TABLE `bug_fixed_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`report_page_id` text NOT NULL,
	`client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	`channel` text NOT NULL CHECK (`channel` IN ('mail', 'telegram', 'whatsapp')),
	`draft_id` integer REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null,
	`messenger_draft_id` integer REFERENCES `messenger_drafts`(`id`) ON UPDATE no action ON DELETE set null,
	`drafted_at` text,
	`told_at` text,
	`notion_told_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bug_fixed_notes_report_client` ON `bug_fixed_notes` (`project`, `report_page_id`, `client_id`);
--> statement-breakpoint
CREATE TRIGGER `live_bug_fixed_notes_ai` AFTER INSERT ON `bug_fixed_notes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'bug_fixed_notes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_bug_fixed_notes_au` AFTER UPDATE ON `bug_fixed_notes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'bug_fixed_notes', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'bug_fixed_notes', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_bug_fixed_notes_ad` AFTER DELETE ON `bug_fixed_notes` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'bug_fixed_notes', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

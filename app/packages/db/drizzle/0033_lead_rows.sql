-- Hand-written (P97 S2, decision 0044): the Leads reader's rows. One row per Notion Leads page the server read as New (or with no
-- Status) in the project's window (`leads.window_days`). Decision 0013: nothing but the page id, the name, the reply address (the
-- email typed on the form, else the Leads Email), the account email, the brand, when it arrived, the Status as last read and at
-- most 120 characters of the Message; the rest of the page is read from Notion when the card opens. `dismissed_*` is the
-- owner's Not now or Spam (Undo clears it); `converted_*` is the first send's link or new Clients card (S4), `convert_note`
-- what the owner must do when Notion refused it. Never deleted by the reader.
CREATE TABLE `lead_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`account_email` text,
	`brand` text,
	`received_at` text DEFAULT '' NOT NULL,
	`preview` text DEFAULT '' NOT NULL,
	`notion_status` text,
	`has_client` integer DEFAULT false NOT NULL,
	`dismissed_at` text,
	`dismissed_reason` text CHECK (`dismissed_reason` IS NULL OR `dismissed_reason` IN ('not_now', 'spam')),
	`converted_at` text,
	`client_page_id` text,
	`convert_note` text,
	`read_at` text NOT NULL,
	`stored_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_rows_project_page` ON `lead_rows` (`project`,`page_id`);--> statement-breakpoint
CREATE INDEX `lead_rows_project_email` ON `lead_rows` (`project`,`email`);--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_lead_rows_ai` AFTER INSERT ON `lead_rows` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_rows', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_lead_rows_au` AFTER UPDATE ON `lead_rows` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_rows', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_rows', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_lead_rows_ad` AFTER DELETE ON `lead_rows` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'lead_rows', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

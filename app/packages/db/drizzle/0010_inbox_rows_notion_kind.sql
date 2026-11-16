CREATE TABLE `inbox_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`mail_ref` text,
	`last_inbound_at` text,
	`mail_class` text,
	`action` text NOT NULL,
	`reason` text,
	`replies_owed` integer DEFAULT false NOT NULL,
	`notion_kind` text,
	`notion_page_id` text,
	`notion_url` text,
	`skill` text,
	`first_seen_at` text NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_rows_project_email` ON `inbox_rows` (`project`,`email`);--> statement-breakpoint
CREATE INDEX `inbox_rows_project_recorded` ON `inbox_rows` (`project`,`recorded_at`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `notion_kind` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `notion_page_id` text;
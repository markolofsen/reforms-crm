CREATE TABLE `send_control` (
	`project` text PRIMARY KEY NOT NULL,
	`stopped` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `send_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`draft_id` integer,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`due_at` text,
	`done_at` text,
	`sender` text,
	`to_addr` text NOT NULL,
	`cc_addr` text,
	`bcc_addr` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`mail_ref` text,
	`sent_message_id` text,
	`error` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_log_draft_live` ON `send_log` (`draft_id`) WHERE "send_log"."status" in ('queued','sending','sent');--> statement-breakpoint
CREATE INDEX `send_log_project_created` ON `send_log` (`project`,`created_at`);--> statement-breakpoint
CREATE INDEX `send_log_due` ON `send_log` (`status`,`due_at`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `injection_suspected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drafts` ADD `mail_class` text;
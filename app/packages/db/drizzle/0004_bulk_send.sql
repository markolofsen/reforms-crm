CREATE TABLE `batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`name` text NOT NULL,
	`intent` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`audience` text NOT NULL,
	`silent_days` integer,
	`client_ids` text DEFAULT '[]' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`excluded` text DEFAULT '{}' NOT NULL,
	`subject_template` text,
	`body_template` text,
	`brief` text,
	`run_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `batches_project_created` ON `batches` (`project`,`created_at`);--> statement-breakpoint
CREATE TABLE `safety_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`level` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_rules_key` ON `safety_rules` (`project`,`kind`);--> statement-breakpoint
DROP INDEX `drafts_client`;--> statement-breakpoint
ALTER TABLE `drafts` ADD `batch_id` integer REFERENCES batches(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `drafts` ADD `tone` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `drafts` ADD `tones` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `mail_ref` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `acked` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `drafts` ADD `prev_status` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `prev_checked` integer;--> statement-breakpoint
ALTER TABLE `drafts` ADD `acted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_client_open` ON `drafts` (`client_id`) WHERE "drafts"."status" in ('ready','hold');--> statement-breakpoint
CREATE INDEX `drafts_batch` ON `drafts` (`batch_id`);--> statement-breakpoint
CREATE INDEX `drafts_client` ON `drafts` (`client_id`);
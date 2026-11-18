CREATE TABLE `enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL,
	`sequence` text NOT NULL,
	`sequence_hash` text NOT NULL,
	`schedule` text NOT NULL,
	`step` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`next_due_at` text,
	`anchor_at` text NOT NULL,
	`enrolled_at` text NOT NULL,
	`enrolled_by` text NOT NULL,
	`finished_at` text,
	`finish_reason` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_client_open` ON `enrollments` (`project`,`client_id`) WHERE "enrollments"."state" in ('active','paused');--> statement-breakpoint
CREATE INDEX `enrollments_project_state` ON `enrollments` (`project`,`state`,`next_due_at`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `enrollment_id` integer REFERENCES enrollments(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `drafts` ADD `sequence_step` integer;

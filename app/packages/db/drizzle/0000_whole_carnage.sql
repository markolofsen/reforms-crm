CREATE TABLE `agent_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`run_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`tool` text,
	`summary` text NOT NULL,
	`detail` text,
	`client_id` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_run_seq` ON `agent_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_events_project` ON `agent_events` (`project`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`trigger` text NOT NULL,
	`skill` text,
	`model` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_runs_project_started` ON `agent_runs` (`project`,`started_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`value_eur` integer DEFAULT 0 NOT NULL,
	`replies_owed` integer DEFAULT false NOT NULL,
	`last_contact_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_project_email` ON `clients` (`project`,`email`);--> statement-breakpoint
CREATE INDEX `clients_project` ON `clients` (`project`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL,
	`run_id` integer,
	`subject` text NOT NULL,
	`to_addr` text NOT NULL,
	`cc_addr` text,
	`body` text NOT NULL,
	`safety` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_client` ON `drafts` (`client_id`);--> statement-breakpoint
CREATE INDEX `drafts_project_status` ON `drafts` (`project`,`status`);--> statement-breakpoint
CREATE TABLE `marks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL,
	`mark` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marks_client_mark` ON `marks` (`client_id`,`mark`);--> statement-breakpoint
CREATE INDEX `marks_project` ON `marks` (`project`);
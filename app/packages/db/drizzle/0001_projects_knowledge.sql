CREATE TABLE `knowledge_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`use` text DEFAULT 'STATE' NOT NULL,
	`approved` integer DEFAULT true NOT NULL,
	`audiences` text DEFAULT '[]' NOT NULL,
	`category` text,
	`kind` text,
	`valid_until` text,
	`body` text DEFAULT '' NOT NULL,
	`phrasings` text DEFAULT '' NOT NULL,
	`front_matter` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_docs_project_path` ON `knowledge_docs` (`project`,`path`);--> statement-breakpoint
CREATE TABLE `project_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`project` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_addresses_address` ON `project_addresses` (`address`) WHERE "project_addresses"."kind" = 'address';--> statement-breakpoint
CREATE UNIQUE INDEX `project_addresses_claim` ON `project_addresses` (`project`,`address`,`kind`);--> statement-breakpoint
CREATE INDEX `project_addresses_project` ON `project_addresses` (`project`);--> statement-breakpoint
CREATE TABLE `project_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`field` text NOT NULL,
	`question` text NOT NULL,
	`options_json` text,
	`default_value` text,
	`status` text DEFAULT 'open' NOT NULL,
	`asked_at` text NOT NULL,
	`answered_at` text,
	`answer` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_questions_one_open` ON `project_questions` (`project`) WHERE "project_questions"."status" = 'open';--> statement-breakpoint
CREATE INDEX `project_questions_project` ON `project_questions` (`project`,`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`settings_json` text NOT NULL,
	`hash` text NOT NULL,
	`synced_at` text NOT NULL
);

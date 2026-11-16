CREATE TABLE `client_identifiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_identifiers_key` ON `client_identifiers` (`project`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `client_identifiers_client` ON `client_identifiers` (`client_id`);--> statement-breakpoint
CREATE TABLE `messenger_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`channel` text NOT NULL,
	`account` text NOT NULL,
	`cursor` text,
	`last_ok_at` text,
	`last_error` text,
	`last_error_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messenger_accounts_key` ON `messenger_accounts` (`project`,`channel`,`account`);--> statement-breakpoint
CREATE TABLE `messenger_chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`channel` text NOT NULL,
	`chat_id` text NOT NULL,
	`title` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messenger_chats_key` ON `messenger_chats` (`project`,`channel`,`chat_id`);--> statement-breakpoint
CREATE TABLE `messenger_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`channel` text NOT NULL,
	`chat_id` text NOT NULL,
	`client_id` integer,
	`text` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`sent_at` text,
	`remote_message_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messenger_drafts_project_status` ON `messenger_drafts` (`project`,`status`);--> statement-breakpoint
CREATE TABLE `messenger_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`channel` text NOT NULL,
	`account` text NOT NULL,
	`chat_id` text NOT NULL,
	`remote_message_id` text NOT NULL,
	`direction` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`sent_at` text NOT NULL,
	`retain_until` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messenger_messages_remote` ON `messenger_messages` (`project`,`channel`,`chat_id`,`remote_message_id`);--> statement-breakpoint
CREATE INDEX `messenger_messages_chat` ON `messenger_messages` (`project`,`channel`,`chat_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `messenger_messages_retain` ON `messenger_messages` (`retain_until`);
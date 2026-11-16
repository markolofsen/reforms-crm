-- P14 (decision 0009): the admin database no longer copies the client record from Notion.
-- Hand-written, like 0004 and 0005: SQLite cannot ADD a column with a non-constant default, so `updated_at`
-- gets a constant default here and is filled by the code (clients.touch and the insert default).
-- DROP COLUMN is safe: neither column is indexed, keyed, checked or referenced by a trigger or a foreign key.
ALTER TABLE `clients` DROP COLUMN `company`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `value_eur`;--> statement-breakpoint
ALTER TABLE `clients` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `clients` SET `updated_at` = `created_at`;--> statement-breakpoint
ALTER TABLE `drafts` ADD `notion_url` text;

-- Hand-written (decision 0049, P141 C1 and U3): a client is keyed by its Hub id and reachable by any one identity, so it needs no
-- email. `clients.email` becomes nullable without a table rebuild (a rebuild inside the migrator's transaction would fire the
-- cascades of marks, drafts, maps and identifiers): a new column takes the values, the old column and its index go, the new column
-- takes the name, and the unique index comes back partial (only a set email is unique). `notion_page_id` is the client's Notion card
-- (unique per project when set; the server's directory read fills it for existing rows by their email). `merged_into` is set on the
-- newer client of a merge (P141 C4): the row is never deleted (rule 16), and a link to it resolves to the older one.
-- `messenger_chats.profile_name` is the name the person gave themselves (WhatsApp's push name, Telegram's display name), shown as
-- theirs and never written to Notion without the owner's click. Additive otherwise; the three live_clients_* and
-- live_messenger_chats_* triggers name only `project`, so they stay as they are (rule 16).
ALTER TABLE `clients` ADD `email_new` text;
--> statement-breakpoint
UPDATE `clients` SET `email_new` = `email`;
--> statement-breakpoint
DROP INDEX `clients_project_email`;
--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `email`;
--> statement-breakpoint
ALTER TABLE `clients` RENAME COLUMN `email_new` TO `email`;
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_project_email` ON `clients` (`project`,`email`) WHERE `email` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `notion_page_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_project_notion_page` ON `clients` (`project`,`notion_page_id`) WHERE `notion_page_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `clients` ADD `merged_into` integer;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `profile_name` text;

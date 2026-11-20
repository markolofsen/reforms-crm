-- Hand-written (P90): a teammate's reply and the Notion stamp, for the open draft card. `drafts.elsewhere_*`: the newest Sent
-- message that answers the draft's mailRef and is not the Hub's (Sent detection). `clients.team_sent_*`: the client's Notion
-- `Last sent at` / `Last sent by` written by another person, as last read. ADD COLUMN keeps the live triggers of 0019.
ALTER TABLE `drafts` ADD `elsewhere_at` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `elsewhere_from` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `elsewhere_message_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `team_sent_at` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `team_sent_by` text;

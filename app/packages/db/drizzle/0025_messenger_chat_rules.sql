-- Hand-written (P71 M2b, research 23 section 2): the rules of one linked chat, on the allow-list row itself, so an unlinked
-- chat still leaves no row (decision 0036 point 3). The bounds are `@hub/config/chat-rules`. ADD COLUMN keeps the three
-- live_messenger_chats_* and live_messenger_drafts_* triggers of 0019 as they are (rule 16): no table is rebuilt.
ALTER TABLE `messenger_chats` ADD `reply_mode` text DEFAULT 'draft' NOT NULL CHECK (`reply_mode` IN ('off', 'on_request', 'draft'));--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `may_nudge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `nudge_after_days` integer DEFAULT 3 NOT NULL CHECK (`nudge_after_days` BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `instruction` text CHECK (`instruction` IS NULL OR length(`instruction`) <= 4000);--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `language` text;--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `prefilter` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `rules_updated_at` text;--> statement-breakpoint
-- What admitted an agent's draft: the owner's words in an `on_request` chat, and whether it is a follow-up after our own last message.
ALTER TABLE `messenger_drafts` ADD `owner_request` text;--> statement-breakpoint
ALTER TABLE `messenger_drafts` ADD `nudge` integer DEFAULT false NOT NULL;

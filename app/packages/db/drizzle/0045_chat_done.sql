-- Hand-written (P143 D1): "no reply needed" on a chat, Mail's No reply needed (`inbound_mail.dismissed_at`) for a chat row.
-- `done_through` is the newest inbound message's own `sent_at` that the mark closes (never the clock), so the chat's next inbound
-- message reopens it by itself; `done_at` is when it was marked, `done_by` owner or agent, `done_reason` the agent's one line.
-- Additive only: ADD COLUMN, no table rebuild, so the three live_messenger_chats_* triggers of 0019 and `messenger_chats_key`
-- stay as they are (rule 16).
ALTER TABLE `messenger_chats` ADD `done_at` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `done_through` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `done_by` text CHECK (`done_by` IS NULL OR `done_by` IN ('owner', 'agent'));
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `done_reason` text CHECK (`done_reason` IS NULL OR length(`done_reason`) <= 300);

-- Hand-written (P71 M4, decision 0036 point 7): one send audit for every channel. A messenger send writes its `send_log` row
-- first like a mail (status `sending`, then `sent` or `failed`); `channel` says which door it went through, `messenger_draft_id`
-- names the messenger draft (`draft_id` stays Mail's). A messenger row keeps `to_addr` = `<channel>:<chat id>`, `sender` = the
-- account id, `subject` = who it went to, `body` = the full text. ADD COLUMN keeps the three live_send_log_* triggers of 0019.
ALTER TABLE `send_log` ADD `channel` text DEFAULT 'mail' NOT NULL CHECK (`channel` IN ('mail', 'telegram_user', 'telegram_bot', 'whatsapp'));--> statement-breakpoint
ALTER TABLE `send_log` ADD `messenger_draft_id` integer REFERENCES `messenger_drafts`(`id`) ON DELETE SET NULL;--> statement-breakpoint
-- A messenger draft has at most one row that is sending or sent (as `send_log_draft_live` holds for a mail draft).
CREATE UNIQUE INDEX `send_log_messenger_draft_live` ON `send_log` (`messenger_draft_id`) WHERE `status` IN ('queued', 'sending', 'sent');--> statement-breakpoint
-- The daily cap and the spacing of one messenger account read its rows by channel, sender and time.
CREATE INDEX `send_log_channel_sender` ON `send_log` (`channel`, `sender`, `created_at`);

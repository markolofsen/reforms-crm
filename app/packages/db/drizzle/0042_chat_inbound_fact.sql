-- Hand-written (decision 0049, P141 W1 and W4): messages are a cache, so "the person wrote" must outlive it. `last_inbound_at` is
-- the newest inbound message the server stored for the chat and `account` the account that read it; ingest writes both and the
-- purge never touches them, so the first-contact rule and the door's account survive a pruned cache. `jid` is a WhatsApp chat's
-- real address (the `@lid` one when WhatsApp gives it), which the history request and the send name. `messenger_messages.source`
-- is `wa_app` for a row only the Mac's WhatsApp app supplied (0049 point 5), else null. Additive only: ADD COLUMN and one
-- backfill UPDATE, no table rebuild, so the three live_messenger_chats_* and live_messenger_messages_* triggers of 0019 and
-- `messenger_chats_key` stay as they are (rule 16).
ALTER TABLE `messenger_chats` ADD `jid` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `last_inbound_at` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `account` text;
--> statement-breakpoint
ALTER TABLE `messenger_messages` ADD `source` text;
--> statement-breakpoint
UPDATE `messenger_chats` SET
  `last_inbound_at` = (SELECT max(m.`sent_at`) FROM `messenger_messages` m WHERE m.`project` = `messenger_chats`.`project` AND m.`channel` = `messenger_chats`.`channel` AND m.`chat_id` = `messenger_chats`.`chat_id` AND m.`direction` = 'in'),
  `account` = (SELECT m.`account` FROM `messenger_messages` m WHERE m.`project` = `messenger_chats`.`project` AND m.`channel` = `messenger_chats`.`channel` AND m.`chat_id` = `messenger_chats`.`chat_id` ORDER BY (m.`direction` = 'in') DESC, m.`sent_at` DESC LIMIT 1);

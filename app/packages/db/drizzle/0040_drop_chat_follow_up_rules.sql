-- Hand-written (owner, 2026-11-24): the follow-up rule of a linked chat is gone. A draft after our own last message is admitted
-- like any other, so `may_nudge` and `nudge_after_days` (0025) hold nothing anyone reads. DROP COLUMN, no table rebuild: neither
-- column is indexed, keyed or referenced by a trigger or a foreign key (the CHECK of `nudge_after_days` is its own and goes with
-- it), so the three live_messenger_chats_* triggers of 0019 and `messenger_chats_key` stay as they are (rule 16).
-- `messenger_drafts.nudge` stays: it records that a draft followed our own last message.
ALTER TABLE `messenger_chats` DROP COLUMN `may_nudge`;--> statement-breakpoint
ALTER TABLE `messenger_chats` DROP COLUMN `nudge_after_days`;

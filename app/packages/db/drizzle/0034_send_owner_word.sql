-- Hand-written (P132 B1-2, decision 0046): the agent sends a messenger draft on the owner's word. `owner_word` is the session
-- log's reference of that word (`<session>@<ts>`), null on every other send; unique, so one word sends at most one draft.
-- Additive only: a running instance keeps working on the old code until it restarts.
ALTER TABLE `send_log` ADD `owner_word` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `send_log_owner_word` ON `send_log` (`owner_word`) WHERE "send_log"."owner_word" is not null;

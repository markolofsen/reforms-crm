-- Hand-written (decision 0048 point 2, P139 A1): a linked chat's autopilot pause, the one autopilot fact `app.db` holds. The
-- switches that turn autopilot on live in protected files (`state/autopilot.json`, the `autopilot` block of send-policy.json),
-- so a row here can only stop it: `autopilot_paused_at` set means paused, with `autopilot_paused_reason` (a code of
-- `PAUSING_REASONS` in `@hub/config/autopilot`). Additive only: ADD COLUMN, no table rebuild, so the three
-- live_messenger_chats_* triggers of 0019 and `messenger_chats_key` stay as they are (rule 16).
ALTER TABLE `messenger_chats` ADD `autopilot_paused_at` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `autopilot_paused_reason` text;

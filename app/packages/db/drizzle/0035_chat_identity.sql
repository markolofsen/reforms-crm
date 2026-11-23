-- Hand-written (P131 O5, verdict 10): a linked chat keeps its own Telegram username (no `@`) and phone (digits), written when the
-- chat is linked (the owner's Link or the autolink) and on a later dialog scan, so its "Open in Telegram" needs no Notion card.
-- Additive only.
ALTER TABLE `messenger_chats` ADD `username` text;
--> statement-breakpoint
ALTER TABLE `messenger_chats` ADD `phone` text;

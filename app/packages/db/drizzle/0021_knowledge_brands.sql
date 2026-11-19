-- Hand-written (P60 B3): the brand axis of the knowledge index. The hashes are cleared so the next `knowledge index`
-- rewrites every row and fills `brands` from the entry files (an unchanged file is otherwise skipped).
ALTER TABLE `knowledge_docs` ADD `brands` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `knowledge_docs` SET `content_hash` = '';

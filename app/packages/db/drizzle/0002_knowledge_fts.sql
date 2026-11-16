-- Hand-written (drizzle-kit generate --custom): drizzle cannot model virtual tables.
-- FTS5 over knowledge_docs, external content: the index stores no copy of the text, the triggers keep it in sync.
-- unicode61 handles Latin and Cyrillic and folds diacritics; no stemmer on purpose (doc 16 section 5).
CREATE VIRTUAL TABLE `knowledge_fts` USING fts5(
	title,
	phrasings,
	body,
	content='knowledge_docs',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `knowledge_docs_ai` AFTER INSERT ON `knowledge_docs` BEGIN
	INSERT INTO knowledge_fts(rowid, title, phrasings, body) VALUES (new.id, new.title, new.phrasings, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER `knowledge_docs_ad` AFTER DELETE ON `knowledge_docs` BEGIN
	INSERT INTO knowledge_fts(knowledge_fts, rowid, title, phrasings, body) VALUES ('delete', old.id, old.title, old.phrasings, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER `knowledge_docs_au` AFTER UPDATE ON `knowledge_docs` BEGIN
	INSERT INTO knowledge_fts(knowledge_fts, rowid, title, phrasings, body) VALUES ('delete', old.id, old.title, old.phrasings, old.body);
	INSERT INTO knowledge_fts(rowid, title, phrasings, body) VALUES (new.id, new.title, new.phrasings, new.body);
END;

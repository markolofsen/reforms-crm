-- Hand-written (P78, decision 0039 point 4): one row per attempt of an LLM call through `@hub/llm`, refusals included. Counts
-- and money only: no prompt, answer or client text has a column. The outcome list is `LLM_OUTCOMES` of `@hub/config/llm`.
-- Three live triggers like every table (0019, rule 16); its topic is `health` (the Overview's LLM part).
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`task` text NOT NULL,
	`model` text,
	`attempt` integer NOT NULL,
	`outcome` text NOT NULL CHECK (`outcome` IN ('ok', 'invalid', 'truncated', 'timeout', 'network', 'rate_limit', 'upstream', 'bad_request', 'no_endpoint', 'content_filter', 'auth', 'credits', 'budget', 'no_key')),
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`tokens_cached` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL CHECK (`cost_micro_usd` >= 0),
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`generation_id` text,
	`source_kind` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_created` ON `llm_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `llm_calls_project_created` ON `llm_calls` (`project`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `live_llm_calls_ai` AFTER INSERT ON `llm_calls` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'llm_calls', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_llm_calls_au` AFTER UPDATE ON `llm_calls` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'llm_calls', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'llm_calls', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_llm_calls_ad` AFTER DELETE ON `llm_calls` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'llm_calls', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

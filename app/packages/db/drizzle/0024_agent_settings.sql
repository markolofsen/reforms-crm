-- Hand-written (P55): the agent's model and its advisor per project, set in Settings ▸ Agent. Absent row = the default in
-- @hub/config. Three live triggers like every table (0019); its topic is `rules` (the same store as the safety rules).
CREATE TABLE `agent_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`model` text NOT NULL,
	`advisor` integer DEFAULT false NOT NULL,
	`advisor_model` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_settings_project` ON `agent_settings` (`project`);--> statement-breakpoint
CREATE TRIGGER `live_agent_settings_ai` AFTER INSERT ON `agent_settings` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'agent_settings', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_agent_settings_au` AFTER UPDATE ON `agent_settings` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'agent_settings', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'agent_settings', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_agent_settings_ad` AFTER DELETE ON `agent_settings` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'agent_settings', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

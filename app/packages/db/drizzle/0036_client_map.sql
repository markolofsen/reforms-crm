-- Hand-written (P135 K2, verdict 1): the client map. `clients.map` is the current Mermaid text the agent redrew after a draft
-- (`client_map`, checked by `@hub/diagram/map` before it is saved), `map_updated_at` when; `client_maps` keeps every version, so
-- a rebuild never loses the previous map. Additive only: a running instance keeps working on the old code until it restarts.
ALTER TABLE `clients` ADD `map` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `map_updated_at` text;
--> statement-breakpoint
CREATE TABLE `client_maps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`client_id` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_maps_client` ON `client_maps` (`client_id`,`id`);--> statement-breakpoint
-- The live triggers of 0019 for the new table (each table is one live topic).
CREATE TRIGGER `live_client_maps_ai` AFTER INSERT ON `client_maps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'client_maps', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_client_maps_au` AFTER UPDATE ON `client_maps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'client_maps', coalesce(NEW.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'client_maps', coalesce(OLD.project, ''), n FROM live_seq WHERE OLD.project IS NOT NEW.project ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;
--> statement-breakpoint
CREATE TRIGGER `live_client_maps_ad` AFTER DELETE ON `client_maps` BEGIN
  UPDATE live_seq SET n = n + 1;
  INSERT INTO live_versions (tbl, project, seq) SELECT 'client_maps', coalesce(OLD.project, ''), n FROM live_seq WHERE true ON CONFLICT (tbl, project) DO UPDATE SET seq = excluded.seq;
END;

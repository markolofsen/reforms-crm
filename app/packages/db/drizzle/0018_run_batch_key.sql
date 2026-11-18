ALTER TABLE `agent_runs` ADD `batch_key` text;--> statement-breakpoint
CREATE INDEX `agent_runs_project_batch_key` ON `agent_runs` (`project`,`batch_key`);
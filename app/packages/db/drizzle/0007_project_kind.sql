-- P19: the registry index carries the project kind and an archived flag (both derived from project.md at sync).
ALTER TABLE `projects` ADD `kind` text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `archived` integer DEFAULT false NOT NULL;
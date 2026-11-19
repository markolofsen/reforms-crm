-- Hand-written (P60 B1/B2, P58 wrote_to): the brand a draft answers for, and one project per forwarded domain.
ALTER TABLE `drafts` ADD `wrote_to` text;--> statement-breakpoint
ALTER TABLE `drafts` ADD `brand` text;--> statement-breakpoint
CREATE UNIQUE INDEX `project_addresses_domain` ON `project_addresses` (`address`) WHERE "project_addresses"."kind" = 'domain';

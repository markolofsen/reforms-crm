-- Hand-written (decision 0055 point 9, P147 3h): the daily mail pass, on the same runner and ledger as the lead pass. Its decision
-- lives on the Mail reader's row it judged (the client's newest open message): the agent's notes, never a gate. `pass_draft_id`
-- is stamped by the record of the pass's draft, `pass_excluded_at` is the owner's untick in the review. `lead_passes.kind` tells
-- the two passes apart in one ledger (one day budget for both); `no_reply` counts the mail pass's No reply proposals.
-- ADD COLUMN only: the live_inbound_mail_* and live_lead_passes_* triggers stay as they are (rule 16).
ALTER TABLE `inbound_mail` ADD `pass_decision` text;--> statement-breakpoint
ALTER TABLE `inbound_mail` ADD `pass_reason` text;--> statement-breakpoint
ALTER TABLE `inbound_mail` ADD `pass_at` text;--> statement-breakpoint
ALTER TABLE `inbound_mail` ADD `pass_id` integer REFERENCES `lead_passes`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `inbound_mail` ADD `pass_draft_id` integer REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `inbound_mail` ADD `pass_excluded_at` text;--> statement-breakpoint
ALTER TABLE `lead_passes` ADD `kind` text DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_passes` ADD `no_reply` integer DEFAULT 0 NOT NULL;

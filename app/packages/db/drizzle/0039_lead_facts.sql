-- Hand-written (P138 E1): four short facts of a lead's form for the Leads list row (the website or first site, the country, the
-- segment, the expected volume), each at most 60 characters; decision 0013's minimum widened by these. Additive only: a running
-- instance keeps working on the old code until it restarts; the next Leads read fills them.
ALTER TABLE `lead_rows` ADD `site` text;--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `country` text;--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `segment` text;--> statement-breakpoint
ALTER TABLE `lead_rows` ADD `volume` text;

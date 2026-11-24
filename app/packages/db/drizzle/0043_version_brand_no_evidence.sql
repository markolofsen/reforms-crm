-- Hand-written (P140 R3 and K2). R3: each Mail version keeps the brand and the address the client wrote to that the signer
-- resolved, so the record of an adopted version takes them from the version, never from another write. K2 (owner, 2026-11-24):
-- the evidence check of drafts is gone, so its columns go (`evidence`, `evidence_source`, `similar_to`, `fingerprint`), the
-- record's findings column keeps only what the record still checks (P60 fact-other-brand) under its own name, the project rows
-- of the removed safety kinds are deleted and the acknowledgements of those kinds dropped from each draft. ADD, DROP and RENAME
-- COLUMN only, no table rebuild, so the live_drafts_*, live_mail_versions_* and live_safety_rules_* triggers of 0019 and 0022
-- stay as they are (rule 16); none of the dropped columns is indexed, keyed or named by a trigger.
ALTER TABLE `mail_versions` ADD `brand` text;
--> statement-breakpoint
ALTER TABLE `mail_versions` ADD `wrote_to` text;
--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `evidence`;
--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `evidence_source`;
--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `similar_to`;
--> statement-breakpoint
ALTER TABLE `drafts` DROP COLUMN `fingerprint`;
--> statement-breakpoint
ALTER TABLE `drafts` RENAME COLUMN `evidence_findings` TO `findings`;
--> statement-breakpoint
UPDATE `drafts` SET `findings` = (SELECT json_group_array(json(j.value)) FROM json_each(`drafts`.`findings`) j WHERE json_extract(j.value, '$.code') = 'fact-other-brand') WHERE `findings` IS NOT NULL AND json_valid(`findings`);
--> statement-breakpoint
DELETE FROM `safety_rules` WHERE `kind` IN ('no_thread_read', 'no_profile_read', 'near_duplicate', 'template_echo', 'profile_empty', 'profile_stale', 'claim_exceeds_observation', 'evidence_claimed', 'fact_without_source', 'evidence_weak');
--> statement-breakpoint
UPDATE `drafts` SET `acked` = (SELECT json_group_array(j.value) FROM json_each(`drafts`.`acked`) j WHERE j.value NOT IN ('no_thread_read', 'no_profile_read', 'near_duplicate', 'template_echo', 'profile_empty', 'profile_stale', 'claim_exceeds_observation', 'evidence_claimed', 'fact_without_source', 'evidence_weak')) WHERE json_valid(`acked`) AND EXISTS (SELECT 1 FROM json_each(`drafts`.`acked`) j WHERE j.value IN ('no_thread_read', 'no_profile_read', 'near_duplicate', 'template_echo', 'profile_empty', 'profile_stale', 'claim_exceeds_observation', 'evidence_claimed', 'fact_without_source', 'evidence_weak'));

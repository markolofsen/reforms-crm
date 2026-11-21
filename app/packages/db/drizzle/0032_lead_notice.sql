-- Hand-written (P97 S1, decision 0044 point 1): why an Inbox row left without work. NULL is the owner's No reply needed (P96);
-- `lead_notice` is the Mail reader's re-judge of a row it stored before the sender was known as a site's notification of a lead
-- (project setting `leads.notice_senders`, or a machine address the filters whitelist). Which senders those are is project config,
-- so this file sets no row: the reader dismisses them on its next pass. ADD COLUMN keeps the live triggers of 0031.
ALTER TABLE `inbound_mail` ADD `dismissed_reason` text;

-- Hand-written (decision 0055 point 8, P147 E4): one person, one reply. The lead's phone or messenger number, digits only (the
-- Leads `Phone`, else a WhatsApp or Telegram number typed as the contact channel), so rows that share it are seen as one person.
-- ADD COLUMN only: the live_lead_rows_* triggers stay as they are (rule 16).
ALTER TABLE `lead_rows` ADD `phone` text;

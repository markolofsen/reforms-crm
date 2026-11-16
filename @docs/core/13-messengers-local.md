# 13. Messengers move into the local CRM

Status: built as an optional package (`app/packages/messengers`, Telegram ingest and human-approved send; research in a decision or plan record kept in the owner's instance), blocked on a bot token, not in use. Originally an owner ask 2026-11-14.

Today: messengers run as a hosted app at a separate subdomain of the owner's domain (code in the old Hub repo: a frontend app, a messengers connector service, a Django app; Hub notifications through Telegram). The owner's point: messengers are launched locally now, so a separate hosted subdomain makes no sense (his words: the owner's instance docs).

Target: `packages/messengers` in the TypeScript monorepo (`08`), used by the local server and the agent. The admin app gets installation (connect a bot or account) and operation (inbox, send as a draft the person confirms, notifications) in one place. Sound notifications (`10`) and "needs a person" push can ride on the same package.

Open, to research before building: which messengers are in use today (Telegram bot confirmed in Hub; others to list from the connector); library per messenger in TypeScript (grammY for Telegram, others to find); whether messages enter the same client history as mail; draft-only rule applies to messengers too; what happens to the hosted messengers subdomain and the Django messengers app (archive after the local one runs, per `04` gates); webhook vs polling on a laptop (polling, no public address).
Inventory first: read the connector and the messengers app before any decision; record in the owner's instance docs.
Track: a decision or plan record kept in the owner's instance.

Research done (a decision or plan record kept in the owner's instance, decision a decision or plan record kept in the owner's instance): grammY long-polling bot first; user accounts and WhatsApp later, read-only; one history with mail via `client_identifiers`.

Built 2026-11-14 (P8): `app/packages/messengers` (`@hub/messengers`), migration 0003, CLI `messengers`; see a decision or plan record kept in the owner's instance. Server wiring, admin screens and the owner's bot token remain.

# Access: which credential goes to what

The single owner page for access. Every other page links here instead of repeating it. A check for each row is a `hub doctor` step; the full ordered list of steps is the generated [`checklist.md`](checklist.md).

No secret is ever stored in git, a log or a page. Secrets live only in the git-ignored `state/secrets/` of the instance (folder mode 700, files mode 600). `HUB_CONFIG_DIR` overrides the folder.

## At a glance

| Access | Goes to | Stored in | Needed for | Verified by |
|---|---|---|---|---|
| Notion connector (OAuth) | The Notion workspace the agent reads and writes in a session | The CLI's own store: Claude Code after `/mcp`; Codex per project home after `codex mcp login notion`; no file of the hub | Every agent session | `notion.connector` (hint only), Agent tools `mcp.answers.notion` |
| Notion hub integration (read) | Every database of each project, whole teamspace | `state/secrets/notion-token` | `notion-dump`, backups, the project doctor's database check | `notion.token`, `notion.access` |
| Notion backend integration (django_notion) | Leads and Clients (write) | The backend's environment; never in the hub | A site's form handler writing leads | Owner only (see below) |
| Mail account | Mail.app, through `mail-mcp` on `localhost:8787` (the agent, read) and `osascript` (the hub: drafts by `hub mcp` `draft_write`, the send, Sent detection) | Mail.app; the name in `config/config.json`; no file in the hub | Reading mail, creating unsent drafts, the confirmed send, Sent detection | `mail.daemon`, `mail.account` |
| Telegram bot token (optional) | A bot made with @BotFather | `state/secrets/telegram-bot-token` | The receive-only poller | `messengers.token`, `telegram.getme`, `messengers.poller` |
| Backup snapshot (`hub backup`) | Nothing external: a folder (default `<instance>/backups/`, git-ignored) | `backups/` or `backup_dir` in `config/config.json` | A copy of the database, the Notion dump and the config that git does not hold | `backup.snapshot` |
| Lead-form canary secret (optional) | One site's form handler: an HMAC key it shares with the hub, one per handler | `state/secrets/<secretRef>` (named in `config/lead-forms.json`); the same value in the site's environment | `hub doctor --only Leads --canary` ([`../core/22-lead-forms.md`](../core/22-lead-forms.md)) | the `leads.<form>` rows (WARN "canary not run" when missing) |
| Claude Code sign-in | The `claude` CLI on this machine | Claude's own store | `hub agent` (the default CLI) | `tools.claude`, Agent tools |
| Codex sign-in (optional) | The `codex` CLI on this machine | Codex's `auth.json`; each project's Codex home (`state/codex/<slug>/`) links to it, never a copy | `hub agent --cli codex` | Agent tools `cli.signed-in` |

The hub holds no API key for Claude or Codex (each CLI signs in itself), no Cloudflare credential and no mail login. The send policy (`state/projects/<slug>/send-policy.json`) and the admin's send ticket are permissions, not credentials: [`../core/24-terminal.md`](../core/24-terminal.md). Mail routing at Cloudflare and any DNS are outside this code; they are not checked here.

## Notion

Two different integrations may exist. They are separate Notion integrations with separate tokens and must not be mixed up.

### The hub integration (read)

An internal integration the owner creates once, in the workspace that holds the CRM teamspaces (notion.so/profile/integrations; creating one needs a workspace owner or admin).

- Capability: **Read content** only. The hub never writes to Notion through it.
- Share it with **the whole teamspace** of each project (open the teamspace, `... > Connections`, add the integration). It must reach:
  - every database listed under `## Notion databases` in `projects/<slug>/project.md`: `clients`, `leads`, `tasks`, `documents` (the core databases; conversation reports are Documents of Type Report) and, where the project has them, `deals`, `organizations`, `open-loops`, `participants`, `expenses`, `payments`, `business-contacts`, `knowledge`;
  - every database those point to through a relation, for example Leads and People (Clients), even when it is not listed.
- The rule of Notion: sharing is per page, database or teamspace. A page shared with an integration shares its children, not its siblings, and a relation target must be shared on its own. A database that is moved to another place, or re-created, **loses its grant**: share the whole teamspace again and read one row to confirm.
- A database that has been archived or merged away still answers 200. The doctor reads the `archived` and `in_trash` flags and fails on it: remove the stale line from `project.md`.
- Store it with `./run.sh token notion` (hidden prompt or standard input), or in the Connections page of the admin. A wrong or missing token fails `notion.token`; a database it cannot see fails `notion.access` and names the database.

### The Notion connector (session)

The Notion connector is what an agent session writes CRM pages with. It needs no token and sees what its user sees. Sign in once with `/mcp` in Claude Code; for Codex once per project home (`CODEX_HOME=state/codex/<slug> codex mcp login notion`, the fix line the Agent tools row prints). `notion.connector` only checks that `.mcp.json` lists the server; Agent tools (`hub doctor --only Agent`, or Connections) shows per CLI whether it answers.

### The backend integration (django_notion)

The owner's own backend writes leads (and clients) into the CRM from a site's form. This is a second integration, with its own token held in the backend's environment. The hub does not read it and the doctor cannot check it.

- Capabilities: Read content, Insert content and Update content.
- Share it with Leads and Clients, which means the whole teamspace (Leads is a top-level database, so sharing a page is not enough).
- It must follow the writer contract in [`../core/21-leads.md`](../core/21-leads.md): `Hub run id` as the idempotency key, only existing select options, no change to Status after create.
- To verify: submit one test lead through the site and look for the row in Leads.

## Mail

- **Mail.app** holds the account (System Settings > Internet Accounts). Keep Mail.app running. The account's exact name goes into `config/config.json` (`account`), with the allowed sender addresses in `allow_list`.
- **mail-mcp** (`brew install dastrobu/tap/mail-mcp`, `brew services start mail-mcp`) reads Mail.app for the agent; its draft tools are denied (they need Mail in front). Drafts are written by `hub mcp` through `osascript`, with the Automation permission the hub's send already needs. macOS must allow mail-mcp under Privacy & Security: Automation.
- **The hub** talks to Mail.app through `osascript` for the confirmed send and for Sent detection (it reads the project's `mail.sent_mailbox` while drafts wait and never launches Mail). macOS asks once to allow the hub to control Mail (Automation). There is no mail login and no mail key in `state/secrets/` (decision 0026).
- A project names its accounts in `project.md` (`mail.accounts`). `hub doctor <project>` fails when an account is not in Mail.

## Telegram (optional)

Create a bot with @BotFather and store the token in `state/secrets/telegram-bot-token` (one `<digits>:<secret>` line) with `./run.sh token telegram`. The server then polls and stores messages; it never sends. A new token applies on the next server start. `telegram.getme` makes one read-only call to confirm Telegram accepts it.

## Backups need access too

`backup.git` needs a remote on which the instance, the core and any path in `backup_repos` (`config/config.json`) are pushed; `backup.notion` needs the hub integration above; `backup.secrets` checks only the names and modes of the files in `state/secrets/`. An off-machine copy of that folder is the owner's job and no step can see it.

### Snapshots (`hub backup`)

`hub backup` is run by the owner (nothing schedules it; decision 0023). It needs no credential of its own and never reads or copies a secret: with `--notion-dump` the dump is a child process that loads the hub integration token itself, and the manifest lists only the NAMES of the secret files.

- **Where:** `<instance>/backups/<YYYYMMDD-HHMMSS>/`, git-ignored (`backups/` is in the instance `.gitignore` and in the template `hub init` uses). `backup_dir` in `config/config.json` moves it (a path relative to the instance folder, such as `../shared-backups`, or an absolute path, for example a Google Drive for desktop folder; no `~`); a folder inside `state/` or the core is refused. The command refuses to run, and `backup.snapshot` fails, when a folder inside the instance is tracked by git or not ignored.
- **One folder, one path:** there is a single backup folder. To survive a dead disk, point `backup_dir` at a folder outside this computer's disk, for example a Google Drive for desktop folder (an absolute path). `backup.snapshot` warns while the folder is inside the instance (next to the data it protects) and passes when it points outside. The newest 14 snapshots are kept in that one folder.
- **What a snapshot holds:** `data/app.db` (`VACUUM INTO` copy, `integrity_check` passed), `config/config.json`, `projects/<slug>/dumps/<date>/` (a COPY of each project's newest existing Notion dump, its age reported, WARN over 7 days with the fix line; `--notion-dump` runs a live dump first, which needs the token and takes minutes to hours), and `manifest.json` (time, core version, instance, sha256 and size of every file, and the table and row counts of the copied database).
- **Use:** `hub backup` (dry run), `hub backup --apply`, `hub backup --apply --notion-dump`, `hub backup --verify [snapshot]`. The newest 14 are kept; `--apply` deletes older ones, only folders with a valid manifest. `--verify` and `backup.snapshot` also RESTORE the snapshot's database: the file is copied into a temporary folder, opened with the current migrations, integrity-checked and its table and row counts compared with the manifest (a snapshot made before v0.6.13 recorded no counts and is only opened and checked); the folder is removed, and a snapshot that cannot restore fails the doctor. Putting a snapshot back into a live instance is never run by the tool: copy files back by hand.
- **A stale Google Drive mount:** after a restart Drive for desktop can also show an old mount named `GoogleDrive-<account> (dd.mm.yyyy hh:mm)` beside the live `GoogleDrive-<account>`. A snapshot made under the dated one is not in your Drive, so `hub backup` and `backup.snapshot` refuse such a `backup_dir` and say which folder to use instead.

## Nothing in the user's home

No credential and no skill is written to the user's home; the one exception (the optional `hub` shortcut) and the old `~/.claude/skills` links (`skills.legacy`) are in [`../core/08-local-app-stack.md`](../core/08-local-app-stack.md), "Where files live".

## Verify

- `hub doctor` runs every step; `hub doctor <project>` adds the project table (accounts, databases, knowledge).
- The ordered, generated list of every step and what it proves: [`checklist.md`](checklist.md).
- Notion in detail (the databases, every field, setup): [`../notion/README.md`](../notion/README.md).

Update this page when the architecture changes.

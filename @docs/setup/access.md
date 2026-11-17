# Access: which credential goes to what

The single owner page for access. Every other page links here instead of repeating it. A check for each row is a `hub doctor` step; the full ordered list of steps is the generated [`checklist.md`](checklist.md).

No secret is ever stored in git, a log or a page. Secrets live only in the git-ignored `state/secrets/` of the instance (folder mode 700, files mode 600). `HUB_CONFIG_DIR` overrides the folder.

## At a glance

| Access | Goes to | Stored in | Needed for | Verified by |
|---|---|---|---|---|
| Notion connector (OAuth, signed in with `/mcp`) | The Notion workspace the agent reads and writes in a session | The Claude session; no file | Every manual session | `notion.connector` (hint only) |
| Notion hub integration (read) | Every database of each project, whole teamspace | `state/secrets/notion-token` | Overview counts, `notion-dump`, the database check | `notion.token`, `notion.access` |
| Notion backend integration (django_notion) | Leads and Clients (write) | The backend's environment; never in the hub | A site's form handler writing leads | Owner only (see below) |
| Mail account | Mail.app, through `mail-mcp` on `localhost:8787` | Mail.app; the name in `config/config.json` | Reading mail, creating unsent drafts | `mail.daemon`, `mail.account` |
| Mail IMAP login (optional) | One account, read only | `state/secrets/mail-<name>.json` | Overview new-mail counts, Sent detection | `backup.secrets` (file mode only) |
| Telegram bot token (optional) | A bot made with @BotFather | `state/secrets/telegram-bot-token` | The receive-only poller | `messengers.token`, `telegram.getme`, `messengers.poller` |
| Backup snapshot (`hub backup`) | Nothing external: a folder (default `<instance>/backups/`, git-ignored) | `backups/` or `backup_dir` in `config/config.json` | A copy of the database, the Notion dump and the config that git does not hold | `backup.snapshot` |
| Claude Code sign-in | The `claude` CLI on this machine | Claude's own store | `hub agent` | `tools.claude` |

The hub expects no Claude API token and no Cloudflare credential. Mail routing at Cloudflare and any DNS are outside this code; they are not checked here.

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

The Claude Notion connector is what an agent session writes CRM pages with. It needs no token and sees what its user sees. Sign in once with `/mcp` in Claude Code. The doctor can only check that `.mcp.json` lists the server; whether you are signed in is visible inside a session.

### The backend integration (django_notion)

The owner's own backend writes leads (and clients) into the CRM from a site's form. This is a second integration, with its own token held in the backend's environment. The hub does not read it and the doctor cannot check it.

- Capabilities: Read content, Insert content and Update content.
- Share it with Leads and Clients, which means the whole teamspace (Leads is a top-level database, so sharing a page is not enough).
- It must follow the writer contract in [`../core/21-leads.md`](../core/21-leads.md): `Hub run id` as the idempotency key, only existing select options, no change to Status after create.
- To verify: submit one test lead through the site and look for the row in Leads.

## Mail

- **Mail.app** holds the account (System Settings > Internet Accounts). Keep Mail.app running. The account's exact name goes into `config/config.json` (`account`), with the allowed sender addresses in `allow_list`.
- **mail-mcp** (`brew install dastrobu/tap/mail-mcp`, `brew services start mail-mcp`) is the one process that controls Mail.app. It can create drafts and has no send tool. macOS must allow it under Privacy & Security: Automation and Accessibility.
- **IMAP login** (optional): a read-only login per account in `state/secrets/mail-<name>.json`. It only adds counts and Sent detection to the admin; the agent does not use it.
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

An instance owns its data, config, secrets, backups and skills. The skills are linked into `<instance>/.claude/skills/` (generated, git-ignored), so a Claude session started in the instance finds them and two instances never share a skill folder. The only thing this tool can write outside the instance is the optional `hub` shortcut, `~/.local/bin/hub`, made by `hub link` only; run the instance with `./run.sh` and you never need it. An older `hub setup` linked the skills into `~/.claude/skills`: `hub doctor` (step `skills.legacy`) lists those links with the one `rm` command that removes them; the hub never deletes them itself.

## Verify

- `hub doctor` runs every step; `hub doctor <project>` adds the project table (accounts, databases, knowledge).
- The ordered, generated list of every step and what it proves: [`checklist.md`](checklist.md).
- Notion in detail (the databases, every field, setup): [`../notion/README.md`](../notion/README.md).

Update this page when the architecture changes.

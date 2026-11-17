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

## Verify

- `hub doctor` runs every step; `hub doctor <project>` adds the project table (accounts, databases, knowledge).
- The ordered, generated list of every step and what it proves: [`checklist.md`](checklist.md).
- Notion in detail (the databases, every field, setup): [`../notion/README.md`](../notion/README.md).

Update this page when the architecture changes.

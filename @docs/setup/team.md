# Instances and teams: start one, join one

How a Hub instance is made, shared with a team and installed on each person's Mac. Any instance, any team size: two, three, four or more people on one instance work the same way. Decision: the plan repo's decision 0043 (P89).

## The layout

- **The core** (`reforms-hub`) is public: code, skills, `@docs/core`, the project template. It never holds a client, an address or a token (`app/apps/installer/test/public-core.test.ts` fails if it does).
- **An instance** is one PRIVATE git repository per business, named `hub-<name>` (for example `hub-saas`, `hub-realty`). It holds `projects/<slug>/` (project.md, knowledge, workflows, sequences, mail filters), its own `@dev`, `@docs/custom`, `@refs` and config. `core/` inside it is a git submodule pinned by `core.version`.
- **No branches.** One branch of a public repo cannot be made private, access on GitHub is per repo, and a branch per instance would need the core merged into every branch forever. One instance, one repo.
- **Two ways in, nothing else:** start a new instance from a core checkout (`hub new-instance`), or join one by cloning its private repo. There are no template or starter repositories (decision 0043, amended 2026-11-20).

## What is shared and what is personal

| Shared by the team | Personal, on each Mac |
|---|---|
| Notion: clients, leads, tasks, documents (the project's teamspace) | `data/app.db`: drafts, records, Activity |
| The private instance repo: `project.md`, knowledge, workflows, sequences, filters, config | Agent sessions and their sign-ins (Claude Code, Codex, the Notion connector) |
| Google Drive: client documents only, linked from the client's `Drive folder` field | Apple Mail accounts (a shared mailbox is fine: each person's drafts are their own) |
| | A Telegram or WhatsApp login of the person's OWN account |
| | `state/` (secrets, sessions, logs, `person.json` with the person's name), autostart |

**Never** put the instance folder, `state/`, `data/app.db`, `.env`, a messenger session, `node_modules` or `.next` in git or on Google Drive, iCloud Drive, Dropbox or OneDrive: SQLite over a synced folder corrupts, a copied messenger session is a second device on one key (440, ban risk), and dependencies churn the sync. `./run.sh setup` fails `files.unsynced` when the folder is in one of those.

When a reply is sent (the admin's Send, `hub send`, or a send Sent detection sees), the Hub writes `Last sent at` and `Last sent by` (your setup name) on the client's Clients page, so the team sees who wrote last. Setting `notion.stamp_sends` (on by default) in project.md switches it; it needs the hub integration with "Update content" and the two fields in Notion ([`../notion/fields.md`](../notion/fields.md#clients), [`access.md`](access.md)).

## Start a new instance

From any core checkout (`./hub.sh` in it) or an existing instance (`./run.sh`). Run inside a git checkout, the new folder goes next to it (`../hub-acme`), never inside it; elsewhere it goes in the current folder; a path is used as given. Until the next core tag, add `--pin main` to get a core with this setup:

```sh
git clone https://github.com/markolofsen/reforms-hub.git && cd reforms-hub
./hub.sh new-instance acme                                 # makes ../hub-acme, core pinned at the newest tag; asks the kind of its first project
cd ../hub-acme && ./run.sh setup                           # your Mac: tools, folders, skills, checks, your name, the personal list
gh repo create <you>/hub-acme --private --source . --remote origin --push   # printed by new-instance; you run it
./run.sh agent acme                                     # then say «настрой проект acme»
```

On a terminal `new-instance` asks one question: the kinds of `./hub.sh project kinds`, numbered; answer a number or a name, or Enter for no project yet (then `./run.sh agent new` and «настрой проект <name>»). In a script, `--kind <kind>` says it and nothing is asked; without it there is no project. `--no-install` leaves the dependencies for `./run.sh setup`; under 5 GB free the install is skipped and said so. The Hub never creates a remote. `./run.sh setup` in the new folder sees a project nobody set up yet and calls it a new instance.

## Join an instance as a teammate

The instance owner adds you to the private repo on GitHub and to the project's Notion teamspace. Then, on your Mac, in a local folder:

```sh
git clone --recurse-submodules https://github.com/<owner>/hub-<name>.git ~/workspace/hub-<name>
cd ~/workspace/hub-<name>
./run.sh setup --person "Your Name"
```

`./run.sh setup` says what it sees ("You are joining an instance the team already set up"), checks out the pinned core if the clone has none, installs Node's packages when they are missing (`core/install.sh`), makes the folders, config and skill links, runs the checks, and ends with **Personal on this Mac**: one line each, `ok`, `TODO`, `opt` or `?`, with the exact fix. It types nothing for you:

- your name (shown in Notion as `Last sent by`);
- each project's Mail account in Apple Mail, added with your own login;
- Claude Code and Codex installed and signed in with your account;
- Notion in your sessions (`/mcp` in a session, your own Notion account);
- optional: the team's Notion read token (from the owner through a password manager, never git or chat; `./run.sh token notion`);
- optional: start after a restart (`./run.sh install --only autostart.agent`);
- optional: your own Telegram or WhatsApp (Messengers ▸ Settings in the admin).

Run it again any time: on a Mac that already runs the instance it is the doctor plus what is new (a newer core, a missing sign-in).

## Working together

- `git pull --rebase --recurse-submodules` before you start; commit small changes to project.md and knowledge (one setting per row, one knowledge entry per file, so merges stay line by line).
- The core moves for everybody at once: one person runs `./run.sh core update <tag> --apply`, commits `core.version`, the others pull.
- Two people on one client: look at `Last sent at` / `Last sent by` in Notion before you write. Drafts are per Mac and do not sync.
- A shared mailbox in two people's Apple Mail: each Hub moves or adopts only drafts it wrote itself. Its Sent detection can still take a teammate's reply in the same thread for your waiting draft; check the client's Notion fields when a draft turns "sent" that you did not send (P89 verdict 9).

Update this page when the architecture changes.

# Workflows (playbooks)

Layer: **core** (the mechanism). The workflows themselves are a project's own files (custom). Rule: `@docs/LAYERS.md`.

A workflow is a written playbook an agent follows for one kind of job: "triage an incoming email", "follow up a quiet client". It lives in the project folder, `projects/<slug>/workflows/<name>.md`, one file per workflow, versioned with the instance. It is **not** a Notion database: Notion holds data (clients, leads, tasks, reports), the instructions live next to the rest of the project's files (decision 0017).

## The file

Front matter, then sections. Parser and rules: `app/packages/projects/src/workflows.ts`.

| Front matter | Values |
| --- | --- |
| `name` | unique in the project |
| `description` | starts "Use when ..."; the agent chooses by it |
| `applies_to` | JSON list: Lead, Client, Deal, Partner, Task |
| `status` | `Draft` (not reviewed), `Active` (reviewed), `Retired` |
| `run_mode` | `Manual`, `Agent may pick`, `Automatic` |

Required sections: `Goal`, `Steps`, `Done when`. Usual: `Input`, `Do not`, `Report back`.

## Who may run which

One rule, `usage()` in `workflows.ts`:

| status | run_mode | usage |
| --- | --- | --- |
| Retired | any | `never` |
| Active | Agent may pick, Automatic | `agent`: the agent picks it when the description fits |
| Active | Manual | `request`: only when the owner names it |
| Draft | any | `request`: only when the owner names it |

A workflow narrows the work and never widens it: no sending, no recipient outside `draft.recipients`, no fact outside `knowledge_search`, whatever the file says. `Automatic` means "may run unasked", not "may send": sending has its own gate.

## Commands

- `hub workflows list <slug>`: each workflow with its usage. `--json` prints the index an agent reads: name, description and file of the workflows it may pick, no bodies.
- `hub workflows check <slug>`: validates every file; exit 1 on an error.
- `hub doctor --project <slug>`: includes the same check ("workflows parse").

## In a session

`triage-mail` step 3b reads the index once per run, and reads the one file whose description fits the client's message. It never reads every body to choose.

## Starter pack

`app/projects/_template/workflows/` holds ten generic playbooks, all Draft, naming no real client or person. `project setup` copies the folder into the new project (`cp -R`); the copy is the project's own, not inherited, so a core update never changes it. To switch one on: read it, edit it, set `status: Active`.

A timed series of follow-ups for a quiet client is not a workflow: it is a sequence, with its own state and owner-only enrolment ([23-sequences.md](23-sequences.md)).

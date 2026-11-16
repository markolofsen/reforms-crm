# Starter workflows (core)

Layer: **core**. Ten generic playbooks for client mail and CRM work, all `status: Draft`. `project setup` copies this folder to `<project>/workflows/`; after that the files are the project's own. Nothing here is inherited: change them, delete them, add yours. They name no real person or client (`@docs/LAYERS.md`).

## How a workflow works

One file per workflow: front matter, then the sections `Goal`, `Input`, `Steps`, `Do not`, `Done when`, `Report back`.

| Front matter | Meaning |
| --- | --- |
| `name`, `description` | The agent chooses a workflow by its description, which starts "Use when ..." |
| `applies_to` | JSON list: `Lead`, `Client`, `Deal`, `Partner`, `Task` |
| `status` | `Draft`: not reviewed, the agent runs it only when you name it. `Active`: reviewed, the agent may pick it. `Retired`: never run. |
| `run_mode` | `Manual`: only when you ask. `Agent may pick`: the agent chooses it when the description fits. `Automatic`: may run unasked (sending still has its own gate). |

An agent picks a workflow on its own only when it is **Active** and its run mode is not Manual. To switch one on, read it, edit what is wrong for your business, then set `status: Active`.

Commands: `hub workflows list <project>` shows each workflow and who may run it; `hub workflows check <project>` validates the files; `hub doctor --project <project>` includes the same check.

Field names in the steps (Grade, Do not contact, Owner note, Next step ...) are the Notion CRM pack's (`app/projects/_template/notion-crm/`, `@docs/notion/fields.md`). Facts come from the knowledge base, never from Notion.

# Starter follow-up sequences (core)

Layer: **core**. Two generic sequences for a client who does not answer, both `status: Draft`. `project setup` copies this folder to `<project>/sequences/`; after that the files are the project's own: change the waits, the steps and the wording, delete them, add yours. They name no real person or client (`@docs/LAYERS.md`).

## How a sequence works

A client is enrolled when the owner says so in a session (`подготовь follow-up молчащим клиентам проекта <slug>`, or naming the client): the `sequence-drafts` skill enrols exactly those, with his words recorded, or he runs `hub sequences enrol` in his own terminal. The agent never enrols on its own initiative. The hub works out when the next step is due. In a session the owner says `подготовь follow-up проекта <slug>`: the skill drafts each due step as a reply to our last message; it shows in Drafts, View "Follow-ups", where he can Stop it. The owner reads it and sends it from Mail. A reply, a bounce, an opt-out or a closed lead ends the follow-ups. Nothing is ever sent by the hub or on a timer.

| Front matter | Meaning |
| --- | --- |
| `name`, `description` | What the sequence is for; the description starts "Use when ..." |
| `status` | `Draft`: not reviewed (test addresses can still be enrolled). `Active`: reviewed. `Retired`: never offered. |
| `applies_to` | JSON list: `Lead`, `Client` (the Notion page the client has) |
| `mail_classes` | JSON list of the kind's mail classes the sequence fits (empty: any) |
| `languages` | JSON list of the languages the steps may be written in |
| `business_days` | `true` (default): waits count Monday to Friday |
| `enrol_after_days` | how long after our message a silent client is offered for enrolment (default 2) |
| `stop_on` | optional; the core stops (replied, bounced, opted_out, closed, excluded) always apply, a file may add `out_of_office` |

Body: `Goal`; `Steps`, a table `# | after (days) | purpose | adds | knowledge topics`; `Last step`; `Do not`; `Opt-out line` (one plain sentence, carried by step 2 and later).
`after` counts days after **our previous message**, not after the first one: a timeline of +2, +5, +9 from the first message is written 2, 3, 4.

Commands: `hub sequences list <project>`, `hub sequences check <project>` (exit 1 on an error), `hub doctor --project <project>` includes the same check. Design: `@docs/core/23-sequences.md`.

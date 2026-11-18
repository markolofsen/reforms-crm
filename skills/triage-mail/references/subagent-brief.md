# Subagent brief (fill in, then give the subagent exactly this text)

A subagent inherits no binding and no skill text. It gets only this brief. The main session replaces every `<...>`. Used by `triage-mail` section 4 and by `bulk-drafts`.

---
You prepare ONE unsent reply draft for ONE client. You do not send, delete or edit anything else.

Project: `<slug>`. Fields from its `project.md` and send policy: accounts `<accounts>`, Sent mailbox `<sent_mailbox>`, tone `<tone>`, signoff `<signoff>`, languages `<languages>`, `clients` source `<clients source id>`. `draft.recipients` verdict for this client: `<admitted | not-allowed>` (not admitted: return `skipped:not-allowed-recipient` and do nothing else).
Client: `<address>` (name `<name>`). Window: `<window>`. Row number: `<n>`.
Batch key: `<batchKey>` (pass it as `context.batchKey` to `hub record-draft` and as `batchKey` to `hub record-client`: the whole run is one session in Activity).
Purpose and tone (bulk only; this is a brief, NOT a body, never paste or lightly edit it): `<purpose and tone line, or "none: answer what the client wrote">`.

Follow this procedure for this client in full, whatever the batch size:
<paste skills/triage-mail/references/per-client.md here, P1 to P7 and the forbidden list, verbatim>

Then the chain of `skills/triage-mail/SKILL.md` section 2 steps 2, 3 and 5 to 7 (idempotent rerun, classify, draft and record, profile, gaps).

Rules, verbatim:
<paste Rules 1 to 6 of skills/README.md here>

Return ONE JSON line and nothing else:
`{"n":<n>,"action":"drafted|skipped:<code>|injection_suspected|noted|error:<tool>","draftMarker":"thread=<thread-id>","recorded":true,"evidence":"ok|weak|missing","read":3,"profile":"filled|empty|absent","facts":2,"anchors":2,"gaps":[],"needs":[]}`
`read` is the number of messages you opened, `facts` the number of knowledge entries you used, `anchors` the number you wrote into the body. Do not round up.
---

After the loop the main session does not trust these lines. It runs `hub batch-check --project <slug> --batch <batchKey>` and puts its result in the report, and for a batch above 3 it runs `hub audit-run` (`skills/README.md`, Isolation audit).

# 27. The typed LLM package (`@hub/llm`)

The Hub's one door to a model API (tracks P78 and P144, decisions `@dev/decisions/0039` and `0051`). A caller declares a task (what it wants, once, at module level) and runs it; the package turns the task's zod 4 schema into a strict structured-output request to OpenRouter, checks the answer, and returns a typed value. It is for cheap, short, structured jobs inside work the owner already started (labelling messages, drafting a reply, reading a public conversation), never for the agent's own reasoning, which stays in the CLIs he signs in to (`claude -p` brains such as the autopilot are out of scope). Callers: `apps/server/src/messengers/preanalysis.ts` (`preanalysisTask`, batch), `apps/server/src/messengers/reply.ts` (`replyTask`, object); the watcher's window task (P144) is next.

Code: `app/packages/llm/src/`, one folder per layer:

| Folder | Holds |
|---|---|
| `transport/` | `types.ts` (the request, the answer, `LlmError`), `openrouter.ts` (the `openai` SDK), `fake.ts` |
| `structured/` | `schema.ts` (the strict walk), `answer.ts` (reading the answer, the zod check, the re-ask) |
| `shapes/` | `object.ts`, `batch.ts`, `window.ts` |
| `budget/` | `ledger.ts` (the `Ledger` shape, `memoryLedger`), `limits.ts` (the instance cap and the task budget) |
| `retry/` | `ladder.ts` (the ladder), `backoff.ts` |
| top | `task.ts` (`defineTask`), `settings.ts` (presets, the key), `index.ts` (`createLlm`) |

It imports `@hub/config`, zod and `openai` 7.55.0 only: the caller passes the ledger, so the package never opens the database, and `@hub/send` never imports it.

## Tasks

```ts
import { createLlm, defineTask } from "@hub/llm";

export const preanalysisTask = defineTask({
  name: "messages.preanalysis",        // the ledger's name of the job; never a model, never client text
  version: 1,                          // bumped when the prompt or schema changes meaning; callers store it (prompt_version)
  preset: "cheap",                     // the named model chain (below); never a model name
  schema: Verdict,                     // a z.object: for batch, ONE item's answer
  system: SYSTEM,                      // fixed text first: a provider's prompt cache reuses the prefix
  shape: { kind: "batch", perCall: 20, maxTokensPerItem: 40 },
  source: { kind: "messenger_message" }, // the ledger's source_kind
  // budget: { monthlyUsd: 2 },        // optional: the task's own monthly budget inside the instance cap
});

const llm = createLlm({ ledger: repos.llmCalls });          // HUB_LLM=fake gives the fake transport
const rs = await llm.run(preanalysisTask, { project, items });
const r = await llm.run(replyTask, { project, input, instructions: "Reply language: Spanish." });
const ws = await llm.run(windowTask, { project, items: messages, dedupe: true });
```

- `defineTask` checks the declaration at import: the name, the version, the budget, a schema with a strict form (the walk below), and for a window the size, the overlap and that its fields are real. `llm.object` and `llm.batch` are gone, with no alias.
- `instructions` are lines a call adds after the fixed system text (a chat's language and the owner's instruction); client text is always the user turn, never the system text.
- **object** (`{ kind: "object", maxTokens? }`, default 1 024): `{ value, model, attempts, costMicroUsd }`.
- **batch** (`{ kind: "batch", perCall?, maxTokensPerItem?, concurrency? }`): `perCall` items (default 20, at most 50) in one request as `{"items":[{"i","input"}]}`, answered `{"items":[{"i","value"}]}`. Only the envelope is checked by the ladder; each `value` is checked against the item schema on its own, so one bad item never fails the rest. An item missing, duplicated or invalid is asked again once, alone, as an object call; only if that fails does the item fail. A chunk that fails as a whole fails its own items with that error. Results: `{ i, ok: true, value, model } | { i, ok: false, error }`, in input order.
- **window** (`{ kind: "window", size, overlap, list, index, refs?, key?, maxTokens?, concurrency? }`): one answer about a stretch of ordered messages, not one per message (P144, ported from the experiment's `analyse.py`: 100 with 20 cost $0.016 per 1 000 messages). Items `{ id, text, author }` are cut every `size - overlap`; a tail under `min(size, 10)` is not sent. Each window is shown as `[n] author: text` lines (n from 1, cut at 500 characters, runs of one character shortened). The answer's `list` field holds entries pointing at messages by `[n]`: `index` is the speaker's message and `refs` are lists of indexes (reactors); ids are joined in code, never copied by the model, and an index outside the window drops its entry. An entry repeated in two windows' overlap (same speaker message, same `key` value) is kept once. `dedupe: true` drops a text already seen (spam) before windowing. One failed window fails alone. **Field order is the schema author's job**: what the model should think through first (threads, topics, mood) comes before the list, or the list comes back empty.
- A failure is an `LlmError` with a `code` (the outcomes below minus `ok`); it extends `HubError` (P126 E1). Callers branch on `code`, never on the message. A caller that gets `no_key` or `budget` says "not analysed" and goes on.
- `llm.monthCost(filter?)`: micro-dollars this calendar month (UTC), for the instance, or `{ project }`, `{ task }`, or both.

## The request

The official `openai` SDK (7.55.0, decision 0051, amending 0039 point 1) against `https://openrouter.ai/api/v1`, as a typed wire only: `maxRetries: 0` (the ladder below is the only retry, so every request is one attempt and one ledger row, the cap checked before it), a per-request `timeout`, the injected `fetch` in tests. Every request carries:

- `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` with the strict schema below;
- `provider: { require_parameters: true, data_collection: "deny" }`, typed beside the SDK's own body (no cast): an endpoint that cannot enforce the schema fails instead of answering free text, and no provider that trains on prompts gets the text (decision 0039 point 3);
- `temperature: 0`, `max_tokens` (the shape's), a timeout per attempt (30 s `cheap`, 60 s `smart`, 90 s `window`).

The answer is read as the raw body, because OpenRouter's `usage.cost` and a 200 that carries an `error` object are not in the SDK's types. The SDK's errors map onto the kinds: a connection timeout or abort is `timeout`, a connection failure `network`, an `APIError` by its status (and `Retry-After` from its headers). The key is scrubbed from every error text. The SDK's own `zodResponseFormat` is not used: it refuses `.optional()` and emits `const` and bounds, which the Gemini leg does not accept (P144 W1, `test/window.test.ts`).

### The strict schema (P78 L0, offline half)

`z.toJSONSchema` (zod 4.6.7, input side) is walked into the subset both legs of a preset accept: Gemini's documented structured-output subset (types, `properties`, `required`, `additionalProperties`, `enum`, `items`, `anyOf`, `description`; `minLength`/`maxLength` and the like are "stripped and ignored"; `oneOf` and `const` are not listed) and OpenAI's strict mode (every key required, objects closed, `anyOf` not `oneOf`).

| zod | zod 4's JSON Schema | sent |
|---|---|---|
| `z.object` | closed, optional keys left out of `required` | closed, every key in `required` |
| `.optional()`, a `.default()` | key not required | `anyOf [T, {type: null}]`, required; a returned `null` is removed before zod parses, so `.optional()` and the default keep their meaning |
| `.nullable()` | `anyOf [T, null]` | the same |
| `z.enum` | `type` + `enum` | the same |
| `z.literal` | `const` | a one-value `enum` |
| `z.discriminatedUnion` | `oneOf` | `anyOf` (the discriminator picks the branch when nulls are removed) |
| `z.union([z.string(), z.number()])` | a type list | `anyOf` of the types |
| `.min`, `.max`, `.int()` bounds, `.length`, `z.iso.datetime()` (`pattern`, `format`), `.describe()` | bounds, `pattern`, `format`, `description` | bounds, `pattern`, `format`, `default`, `title`, `$schema` dropped and enforced by zod after the parse; `description` kept: it is what the model reads as the field's instruction (django-cfg drops it) |
| `z.record`, a recursive schema (`$ref`), `z.tuple`, an intersection, a non-object root | | refused with `SchemaError` before any request |

Not settled offline: whether Gemini's state-machine limits ("very large or deeply nested schemas may be rejected") admit a 20-item envelope of a wide item schema. That is the live half of L0 (below).

## The ladder

Per model of the preset, in order: a retryable failure (`timeout`, `network`, 429 `rate_limit`, 5xx `upstream`) is retried on the same model up to twice, with full-jitter backoff from 1 s (cap 20 s) or the `Retry-After` the provider sent; a cut answer (`finish_reason: "length"`) is retried once with twice the `max_tokens` (at most 32 768), never repaired; a wrong shape or text that is not JSON is re-asked once with zod's issues (paths and messages, never values); then the next model. A 404 (no endpoint keeps `require_parameters` and `data_collection: "deny"`), 400 or 403 goes to the next model. 401 (`auth`) and 402 (`credits`) stop at once: the next model would fail the same way.

## Presets

A task names a preset, never a model (decision 0039 point 6): the preset is the task's declared, named model chain. `config.json` → `llm.presets.<name>` may replace a list.

| Preset | Chain | Use |
|---|---|---|
| `cheap` | `google/gemini-2.5-flash-lite`, then `openai/gpt-4o-mini` | extraction and labels |
| `smart` | `google/gemini-3.1-flash-lite`, then `openai/gpt-4.1-mini` | judgement; the first is a thinking model, so its `max_tokens` floor is 2 048 |
| `window` | `openai/gpt-4o-mini`, then `google/gemini-2.5-flash-lite` | a window of a public conversation: precision and cost were measured on gpt-4o-mini; Gemini leads only once it measures as precise for no more cost (P144 W5) |

## The key

OpenRouter's, read in this order, first found wins: `OPENROUTER_API_KEY`; the machine's file `~/.config/reforms-hub/openrouter-key` (`machineDir()` of `@hub/config/paths`, `HUB_MACHINE_DIR` overrides the folder; one key every instance on the Mac reads, owner 2026-11-25); the instance's `state/secrets/openrouter-key` (`HUB_CONFIG_DIR` overrides the folder). The key alone in the file, mode 600; a file readable by others is refused. Read on every call, so a key stored while the server runs is used at once. Never logged, never in an error (the transport scrubs it), never in the ledger, never backed up. Messengers ▸ Settings says which source the key in use comes from (`keySource`: `env`, `machine` or `instance`), never the value. Without a key a call is refused before any request with `no_key`, and the sentence names both files. The machine's file is found only through the `HOME` of the env handed in, so a test never reads the owner's real file (the shared test setup points `HUB_MACHINE_DIR` into its temp folder).

## The ledger and the cap

- `llm_calls` in `app.db` (migration 0026, the three `live_*` triggers of rule 16): one row per attempt, failed and refused ones included: project, task, model, attempt, outcome, tokens in, out and cached, `usage.cost` as whole micro-dollars, latency, OpenRouter's generation id, the source kind. No prompt, no answer, no client text has a column ("I am not against loading the database, I am against loading junk into it", the owner, 2026-11-20).
- Outcomes (`LLM_OUTCOMES` in `@hub/config/llm`): `ok`, `invalid`, `truncated`, `timeout`, `network`, `rate_limit`, `upstream`, `bad_request`, `no_endpoint`, `content_filter`, `auth`, `credits`, and the Hub's two refusals `budget` and `no_key` (cost 0). A refusal repeated for the same project, task and kind within 10 minutes is not written again, so a refused poller does not fill the table.
- The task budget (decision 0051): a task may declare `budget.monthlyUsd`; before every attempt its own month's spend (`monthCost({ task })`, the `task` column) is checked beside the cap, and at or over it the call is refused with `budget`. The watcher's tasks default to $2 inside the $5 cap, so they cannot starve the pre-analysis and the reply.
- The cap: `config.json` → `llm.monthly_cap_usd`, a number from 0 to 10 000; absent or unreadable, **5**: a paid key is never unlimited by omission. It is the instance's total for the calendar month in UTC, over every project (one key, one bill). Before every attempt the month's spend is summed; at or over the cap the call is refused with `budget` before any request. 0 refuses every call.
- Overview: an instance part "LLM (OpenRouter)" appears once a caller has used it this month. It is broken, so a "Needs you" item, while a `no_key` refusal is newer than the last answer and the key is still missing, or while the cap is reached and a call was refused; the fix line is the package's own sentence. Otherwise it says the month's spend against the cap. Its live topic is `health`.
- No raw trail is kept in v1. If one is added, it goes to `state/llm/<slug>/<date>.jsonl`, rotated like the agent log and never backed up, never to the database.

## No cache

The owner does not expect one to pay (2026-11-20), and the first caller never repeats input. Add one only when a caller re-judges the same text, with expiry no later than the text's own retention (decision 0039 point 5).

## Tests

`HUB_LLM=fake` selects the fake transport, as `HUB_MAILER=fake` selects the fake Mailer: it answers from the request's own schema (one item per index for a batch), costs 10 micro-dollars per answer, and never leaves the process. Any other value of `HUB_LLM` stops `createLlm`. The package's Vitest setup makes the global `fetch` throw and removes `OPENROUTER_API_KEY` and `HUB_LLM` from the environment, so a test that forgot to inject a transport fails loudly. `app/packages/llm/test/`: the strict walk, the ladder and the task budget, the batch (20 items, one broken, failing alone), the window (cutting, rendering, index mapping, the overlap repeat, one window failing alone), the SDK transport against an injected fetch (`maxRetries: 0`, the provider field, `usage.cost` from the raw body, a 200 that carries an error, `Retry-After`, the key scrubbed, a timeout), the key's three sources, the real `llm_calls` table.

Update this page when the architecture changes.

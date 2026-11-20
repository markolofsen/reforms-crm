# 27. The typed LLM package (`@hub/llm`)

The Hub's one door to a model API (track P78, decision `@dev/decisions/0039`). It turns a zod 4 schema into a strict structured-output request to OpenRouter, checks the answer, and returns a typed value. It is for cheap, short, structured jobs inside work the owner already started (labelling messages, tagging threads), never for the agent's own reasoning, which stays in the CLIs he signs in to. No caller uses it yet: P71 (messenger pre-analysis) and P79 (Threads topics) are the first.

Code: `app/packages/llm/src/` (eight files). It imports `@hub/config` and zod only: the caller passes the ledger, so the package never opens the database, and `@hub/send` never imports it.

## The two calls

```ts
import { createLlm } from "@hub/llm";
const llm = createLlm({ ledger: repos.llmCalls });          // HUB_LLM=fake gives the fake transport

const r = await llm.object({
  task: "messages.preanalysis",   // the job's name, for the ledger; never a model, never client text
  schema: Preanalysis,            // a z.object
  system: PROMPT,                 // stable text first (a provider's prompt cache reuses the prefix)
  input: text,                    // a string, or a list of messages
  project: "<slug>",
  source: { kind: "messenger_message" },
  preset: "cheap",                // the default; "smart" for judgement
});
r.value; r.model; r.attempts; r.costMicroUsd;

const rs = await llm.batch({ task, schema: Item, system, items, project, perCall: 20, concurrency: 3 });
// rs[k]: { i, ok: true, value, model } | { i, ok: false, error }, in input order
```

- `batch` sends `perCall` items (default 20, at most 50) in one request as `{"items":[{"i","input"}]}` and asks for `{"items":[{"i","value"}]}`. Only the envelope is checked by the ladder; each `value` is checked against `Item` on its own, so one bad item never fails the rest. An item missing, duplicated or invalid is asked again once, alone, through `object`; only if that fails does the item fail. A chunk that fails as a whole (the cap, the key, every model down) fails its own items with that error. OpenRouter has no batch endpoint: "batch" is many items per request and a few requests at once.
- A failure is an `LlmError` with a `kind` (the outcomes below minus `ok`). Callers branch on `kind`, never on the message. A caller that gets `no_key` or `budget` says "not analysed" and goes on; nothing fails because the LLM is absent.
- `llm.monthCost(project?)`: micro-dollars this calendar month (UTC), for one project or the instance.

## The request

Plain `fetch` to `https://openrouter.ai/api/v1/chat/completions`, no SDK (`openai` 7.53.0 is the named fallback if plain fetch proves wrong; the public API would not change). Every request carries:

- `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` with the strict schema below;
- `provider: { require_parameters: true, data_collection: "deny" }`: an endpoint that cannot enforce the schema fails instead of answering free text, and no provider that trains on prompts gets client text (decision 0039 point 3);
- `temperature: 0`, `max_tokens` (default 1 024 for `object`, 200 per item plus 200 for `batch`), a timeout per attempt (30 s `cheap`, 60 s `smart`).

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

A task names a preset, never a model (decision 0039 point 6). `config.json` → `llm.presets.<name>` may replace a list.

| Preset | Chain | Use |
|---|---|---|
| `cheap` | `google/gemini-2.5-flash-lite`, then `openai/gpt-4o-mini` | extraction and labels |
| `smart` | `google/gemini-3.1-flash-lite`, then `openai/gpt-4.1-mini` | judgement; the first is a thinking model, so its `max_tokens` floor is 2 048 |

## The key

OpenRouter's, the Hub's own key with its own monthly limit set at OpenRouter (not the MLS key): `OPENROUTER_API_KEY`, else `state/secrets/openrouter-key` (`HUB_CONFIG_DIR` overrides the folder), the key alone in the file, mode 600; a file readable by others is refused. Read on every call, so a key stored while the server runs is used at once. Never logged, never in an error (the transport scrubs it), never in the ledger, never backed up. It is not a Settings ▸ Connections row yet. Without it a call is refused before any request with `no_key`, and the sentence names the file.

## The ledger and the cap

- `llm_calls` in `app.db` (migration 0026, the three `live_*` triggers of rule 16): one row per attempt, failed and refused ones included: project, task, model, attempt, outcome, tokens in, out and cached, `usage.cost` as whole micro-dollars, latency, OpenRouter's generation id, the source kind. No prompt, no answer, no client text has a column ("I am not against loading the database, I am against loading junk into it", the owner, 2026-11-20).
- Outcomes (`LLM_OUTCOMES` in `@hub/config/llm`): `ok`, `invalid`, `truncated`, `timeout`, `network`, `rate_limit`, `upstream`, `bad_request`, `no_endpoint`, `content_filter`, `auth`, `credits`, and the Hub's two refusals `budget` and `no_key` (cost 0). A refusal repeated for the same project, task and kind within 10 minutes is not written again, so a refused poller does not fill the table.
- The cap: `config.json` → `llm.monthly_cap_usd`, a number from 0 to 10 000; absent or unreadable, **5**: a paid key is never unlimited by omission. It is the instance's total for the calendar month in UTC, over every project (one key, one bill). Before every attempt the month's spend is summed; at or over the cap the call is refused with `budget` before any request. 0 refuses every call.
- Overview: an instance part "LLM (OpenRouter)" appears once a caller has used it this month. It is broken, so a "Needs you" item, while a `no_key` refusal is newer than the last answer and the key is still missing, or while the cap is reached and a call was refused; the fix line is the package's own sentence. Otherwise it says the month's spend against the cap. Its live topic is `health`.
- No raw trail is kept in v1. If one is added, it goes to `state/llm/<slug>/<date>.jsonl`, rotated like the agent log and never backed up, never to the database.

## No cache

The owner does not expect one to pay (2026-11-20), and the first caller never repeats input. Add one only when a caller re-judges the same text, with expiry no later than the text's own retention (decision 0039 point 5).

## Tests

`HUB_LLM=fake` selects the fake transport, as `HUB_MAILER=fake` selects the fake Mailer: it answers from the request's own schema (one item per index for a batch), costs 10 micro-dollars per answer, and never leaves the process. Any other value of `HUB_LLM` stops `createLlm`. The package's Vitest setup makes the global `fetch` throw and removes `OPENROUTER_API_KEY` and `HUB_LLM` from the environment, so a test that forgot to inject a transport fails loudly. `app/packages/llm/test/`: the strict walk, the ladder, the batch (20 items, one broken, failing alone), the transport against an injected fetch, the key, the real `llm_calls` table.

Update this page when the architecture changes.

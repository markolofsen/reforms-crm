import { LlmError, type ChatRequest, type ChatResponse, type LlmErrorKind, type Transport } from "./transport";

/**
 * The fake transport (decision 0039 point 7): `HUB_LLM=fake` selects it, as `HUB_MAILER=fake` selects the fake Mailer. It never
 * leaves the process. Scripted, it answers by request number and records every request; unscripted, it answers a value built
 * from the request's own schema (the first enum value, "fake", 0, false, empty lists), and for a batch one item per index it was
 * sent, so a server run on the fake exercises the whole path, ledger included (10 micro-dollars per answer).
 */

export type FakeReply =
  | { content: string | null; finishReason?: string; costUsd?: number; tokensIn?: number; tokensOut?: number }
  | { error: LlmErrorKind; status?: number; retryAfterMs?: number; message?: string; costUsd?: number };

/** `n` counts from 0 over every request this fake has answered. */
export type FakeScript = (req: ChatRequest, n: number) => FakeReply | Promise<FakeReply>;

export const FAKE_COST_USD = 0.00001;

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** A value of the strict schema: the first branch, the first enum value, a fixed word, zero, false, an empty list. */
export function sampleOf(n: unknown): unknown {
  if (!isNode(n)) return null;
  if (Array.isArray(n.enum)) return n.enum[0] ?? null;
  if (Array.isArray(n.anyOf)) return sampleOf(n.anyOf.find((b) => isNode(b) && b.type !== "null") ?? n.anyOf[0]);
  switch (n.type) {
    case "string": return "fake";
    case "number":
    case "integer": return 0;
    case "boolean": return false;
    case "array": return [];
    case "null": return null;
    case "object": return Object.fromEntries(Object.entries(isNode(n.properties) ? n.properties : {}).map(([k, s]) => [k, sampleOf(s)]));
    default: return null;
  }
}

/** The batch envelope `{ items: [{ i, value }] }`, answered with one item per index found in the last user message. */
function batchAnswer(req: ChatRequest): unknown | undefined {
  const items = isNode(req.schema.properties) ? req.schema.properties.items : undefined;
  const item = isNode(items) && isNode(items.items) ? items.items : undefined;
  const props = item && isNode(item.properties) ? item.properties : undefined;
  if (!props || !("i" in props) || !("value" in props)) return undefined;
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  let sent: unknown = null;
  try {
    sent = JSON.parse(last?.content ?? "null");
  } catch {
    sent = null;
  }
  const list = isNode(sent) && Array.isArray(sent.items) ? sent.items : [];
  const ids = list.flatMap((x) => (isNode(x) && typeof x.i === "number" ? [x.i] : []));
  return { items: ids.map((i) => ({ i, value: sampleOf(props.value) })) };
}

const defaultScript: FakeScript = (req) => ({ content: JSON.stringify(batchAnswer(req) ?? sampleOf(req.schema)) });

export function fakeTransport(script: FakeScript = defaultScript): Transport & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    name: "fake",
    requests,
    async chat(req): Promise<ChatResponse> {
      const n = requests.length;
      requests.push(structuredClone(req));
      const r = await script(req, n);
      const costMicroUsd = Math.round((r.costUsd ?? FAKE_COST_USD) * 1e6);
      if ("error" in r) {
        throw new LlmError(r.error, r.message ?? `${req.model}: fake ${r.error}`, { status: r.status ?? null, retryAfterMs: r.retryAfterMs ?? null, usage: { tokensIn: 0, tokensOut: 0, tokensCached: 0, costMicroUsd: r.costUsd === undefined ? 0 : costMicroUsd } });
      }
      return {
        content: r.content,
        finishReason: r.finishReason ?? "stop",
        usage: { tokensIn: r.tokensIn ?? 100, tokensOut: r.tokensOut ?? 20, tokensCached: 0, costMicroUsd },
        generationId: `fake-${n + 1}`,
      };
    },
  };
}

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { keys, TOPIC_KEYS } from "../src/lib/cache/keys";
import { invalidateTopics } from "../src/lib/cache/topics";

// P127 B2: a command's topics invalidate exactly the keys TOPIC_KEYS names for them, the same map a live frame applies.
const seed = () => {
  const qc = new QueryClient();
  for (const k of [keys.rules("p"), keys.agentSettings("p"), keys.activity("p", "all", null), keys.rules("q"), keys.draftMail("p", 1)]) qc.setQueryData(k, 1);
  return qc;
};
const stale = (qc: QueryClient) => qc.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey.join("/")).sort();
const prefixed = (qc: QueryClient, topics: Parameters<typeof invalidateTopics>[2], project: string) =>
  qc.getQueryCache().getAll().filter((q) => topics.some((t) => TOPIC_KEYS[t](project).some((k) => k.every((part, i) => q.queryKey[i] === part)))).map((q) => q.queryKey.join("/")).sort();

describe("invalidateTopics", () => {
  it("invalidates the rules topic's keys of that project only, never another project's or a Mail read", async () => {
    const qc = seed();
    await invalidateTopics(qc, "p", ["rules"]);
    expect(stale(qc)).toEqual(prefixed(qc, ["rules"], "p"));
    expect(stale(qc)).not.toContain(keys.rules("q").join("/"));
    expect(stale(qc)).not.toContain(keys.draftMail("p", 1).join("/"));
  });
  it("reads Mail again only when the command names mail", async () => {
    const qc = seed();
    await invalidateTopics(qc, "p", ["rules", "mail"]);
    expect(stale(qc)).toContain(keys.draftMail("p", 1).join("/"));
  });
});

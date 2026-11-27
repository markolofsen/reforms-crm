import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { AGENT_SEND_HEADER, readAgentSendToken } from "@hub/agent/send-token";
import { instancePorts } from "@hub/config/paths";
import { watchActionParam, watchActionQuery, watchProposalBody, watchProposalParam, watchReplyBody, watchReconcileBody } from "@hub/contract/watch-actions";
import { readWatchPolicy, watchPolicyFile } from "@hub/watch/policy";
import type { Ctx } from "../context";
import { ctxOf } from "./shared";
import { setWatchPolicy } from "./watch-policy";

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Credentials stay inside the supported CLI; only the local instance port can receive them. */
export async function callWatchAction(ctx: Ctx, project: string, method: "GET" | "POST", route: string, body?: unknown): Promise<unknown> {
  watchActionParam.parse({ slug: project });
  const token = readAgentSendToken(ctx.paths);
  if (!token) throw new Error("Start the Hub server first; its supported local action token is unavailable.");
  const port = instancePorts(ctx.paths).api;
  const response = await ctx.fetch(`http://127.0.0.1:${port}/api/projects/${project}/watch/actions/${route}`, {
    method, headers: { [AGENT_SEND_HEADER]: token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000),
  });
  const result: unknown = await response.json();
  if (!response.ok || (typeof result === "object" && result !== null && ["failed", "uncertain"].includes(String(Reflect.get(result, "status"))))) process.exitCode = 2;
  return result;
}

export function registerWatchActions(watch: Command): void {
  const policy = watch.command("policy").description("Inspect or set a protected owner grant for public actions.");
  policy.command("show").requiredOption("--project <slug>").action((o: { project: string }) => {
    const { paths } = ctxOf();
    watchActionParam.parse({ slug: o.project });
    print(readWatchPolicy(join(paths.projects, o.project), watchPolicyFile(paths.stateProjects, o.project)));
  });
  policy.command("set").description("Owner shell: validate a reviewed policy JSON, strategy digest and next revision; atomically grant/revoke with audit.")
    .requiredOption("--project <slug>").requiredOption("--file <json>").action((o: { project: string; file: string }) => {
      const input: unknown = JSON.parse(readFileSync(o.file, "utf8"));
      print(setWatchPolicy(ctxOf().paths, o.project, input));
    });

  const reply = watch.command("reply").description("Externally reviewed public reply through the CRM send door; no automatic content generation.");
  reply.command("context").description("Read exact source, current permissions and description/latest pinned message; sends nothing.")
    .requiredOption("--project <slug>").requiredOption("--direction <id>").requiredOption("--group <username>").requiredOption("--message <id>")
    .action(async (o: { project: string; direction: string; group: string; message: string }) => {
      const q = watchActionQuery.parse({ direction: o.direction, group: o.group, messageId: o.message });
      const query = new URLSearchParams({ direction: q.direction, group: q.group, messageId: String(q.messageId) });
      print(await callWatchAction(ctxOf(), o.project, "GET", `context?${query}`));
    });
  reply.command("propose").description("Store immutable reviewed text and source/rules hashes; sends nothing.")
    .requiredOption("--project <slug>").requiredOption("--file <json>").action(async (o: { project: string; file: string }) => {
      const body = watchProposalBody.parse(JSON.parse(readFileSync(o.file, "utf8")));
      print(await callWatchAction(ctxOf(), o.project, "POST", "proposals", body));
    });
  reply.command("show").description("Read the immutable proposal and durable send/receipt status.")
    .requiredOption("--project <slug>").requiredOption("--proposal <id>").action(async (o: { project: string; proposal: string }) => {
      const p = watchProposalParam.parse({ slug: o.project, id: o.proposal });
      print(await callWatchAction(ctxOf(), p.slug, "GET", `proposals/${p.id}`));
    });
  reply.command("send").description("Send this exact reviewed text once, subject to the protected grant, fresh provider checks, Stop and shared account caps.")
    .requiredOption("--project <slug>").requiredOption("--proposal <id>").requiredOption("--text-hash <sha256>")
    .action(async (o: { project: string; proposal: string; textHash: string }) => {
      const p = watchProposalParam.parse({ slug: o.project, id: o.proposal });
      const body = watchReplyBody.parse({ textHash: o.textHash });
      print(await callWatchAction(ctxOf(), p.slug, "POST", `proposals/${p.id}/send`, body));
    });
  reply.command("reconcile").description("Prove an unresolved delivery against its exact provider message; never sends or retries.")
    .requiredOption("--project <slug>").requiredOption("--proposal <id>").option("--message <id>")
    .action(async (o: { project: string; proposal: string; message?: string }) => {
      const p = watchProposalParam.parse({ slug: o.project, id: o.proposal });
      const body = watchReconcileBody.parse(o.message === undefined ? {} : { messageId: Number(o.message) });
      print(await callWatchAction(ctxOf(), p.slug, "POST", `proposals/${p.id}/reconcile`, body));
    });
}

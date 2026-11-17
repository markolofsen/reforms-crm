import { ADMIN_PORT } from "@hub/config";
import { instancePorts } from "@hub/config/paths";
import type { Ctx } from "../context";
import type { CheckResult, Step } from "../types";
import { fail, pass } from "./helpers";

const LSOF = "/usr/sbin/lsof";

/** Addresses (`host:port`) listening on a TCP port, from lsof; empty when nothing does. */
export async function listenersOf(ctx: Ctx, port: number): Promise<string[]> {
  const r = await ctx.run(LSOF, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"]);
  return r.stdout.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
}

/**
 * The admin must answer on loopback and nowhere else (`app/@rules/architecture-and-ownership.md` 12). Not running is a pass:
 * `hub up` starts it. Running on the wildcard address is the failure: `next start` without `-H 127.0.0.1` listens on every interface.
 */
export async function adminLoopbackCheck(ctx: Ctx, port: number): Promise<CheckResult> {
  const listeners = await listenersOf(ctx, port);
  if (!listeners.length) return pass(`not running (hub up starts it on 127.0.0.1:${port})`);
  const open = listeners.filter((l) => /^(\*|0\.0\.0\.0|\[::\]):/.test(l));
  if (open.length) return fail(`port ${port} listens on ${open.join(", ")}, not on 127.0.0.1 only: stop it and start the admin with hub up`);
  try {
    const res = await ctx.fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    return pass(`answers on 127.0.0.1:${port} (HTTP ${res.status}), loopback only`);
  } catch {
    return fail(`something listens on ${listeners.join(", ")} but does not answer on 127.0.0.1:${port}`);
  }
}

export const adminSteps: Step[] = [
  {
    id: "admin.loopback", group: "Admin", title: "The admin listens on this machine only",
    why: "The admin can send mail; it must never be reachable from the network.",
    verifies: `If the admin is running, the instance admin port (admin_port in config/config.json, or HUB_ADMIN_PORT; default ${ADMIN_PORT}) answers on 127.0.0.1 and no listener is bound to every interface. Not running is fine.`,
    check: (ctx) => adminLoopbackCheck(ctx, instancePorts(ctx.paths).admin),
    manual: { steps: ["Stop whatever listens on the admin port, then start the admin with `hub up`; it always binds 127.0.0.1."] },
  },
];

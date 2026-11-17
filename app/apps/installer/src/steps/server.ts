import { instancePorts } from "@hub/config/paths";
import { listenersOf } from "./admin.ts";
import type { Step } from "../types.ts";
import { fail, pass, warn } from "./helpers.ts";

export const serverSteps: Step[] = [
  {
    id: "server.health", group: "Server", title: "The local server answers",
    why: "The local app (marks, queue, the messengers poller) runs behind one Hono server. The admin and every screen talk to it, so a server that is up but unhealthy breaks them while the admin still loads.",
    verifies: "If something listens on the instance API port (api_port in config/config.json, or HUB_PORT; default 4317), it listens on 127.0.0.1 only and `GET /api/health` answers 200 with `ok`. Not running is a WARN (`hub up` starts it), never a pass: this step says nothing about a server that is not there.",
    manual: { steps: ["Start it with `hub up` (it binds 127.0.0.1). If the port is held by something else, change `api_port` in `config/config.json`."] },
    async check(ctx) {
      const port = instancePorts(ctx.paths).api;
      const open = (await listenersOf(ctx, port)).filter((l) => /^(\*|0\.0\.0\.0|\[::\]):/.test(l));
      if (open.length) return fail(`port ${port} listens on ${open.join(", ")}, not on 127.0.0.1 only: stop it and start the server with hub up`);
      try {
        const r = await ctx.fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return fail(`GET /api/health answered ${r.status} on 127.0.0.1:${port}`);
        const h = (await r.json().catch(() => ({}))) as { ok?: boolean };
        return h.ok === false ? fail(`/api/health on 127.0.0.1:${port} reports ok: false`) : pass(`answers on 127.0.0.1:${port}`);
      } catch {
        return warn(`not running on 127.0.0.1:${port} (hub up starts it)`);
      }
    },
  },
];

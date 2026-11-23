import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { POINTER_MAX_REFS, POINTER_NOTE_MAX, POINTER_TTL_MS } from "@hub/contract/pointer";
import { readFocus, resolveRef, writePointer } from "../../focus";
import type { ToolCtx } from "../ports";
import { cut, DATA, READ_ONLY, run, ToolError } from "../result";

// P51, P72 (decision 0038): what the owner's admin shows, and `highlight`, the pointer: up to five refs on the owner's
// screen get a ring for 30 s. It writes only `state/pointer.json` and bumps the live topic `pointer` (`pointerWritten`, a
// short connection like `mailWritten`); it never clicks, types, opens or navigates, and no tool of this server does.

export function registerFocusTools(server: McpServer, { repos, env, project }: ToolCtx): void {
  server.registerTool(
    "focus",
    {
      title: "What the owner's admin shows",
      description: `What the owner sees in the Hub admin right now, for this project: the screen (route and title), \`subject\` (the record the address or the open card names), \`pointed\` (the row he clicked or arrowed to), \`selected\` (picked rows), \`window\` (the rows on screen and the list's total), the view and search, and the outcome of your last \`highlight\`. Each item is a ref (\`<kind>:<id>\`) with its title, status and \`read\`: the server, tool and arguments that read it (knowledge-mcp \`knowledge_get\` for an entry, \`draft_show\` for a draft). "этот клиент", "this draft", "эта запись", "вот это", "то, что выделено", "на что я смотрю" mean \`subject\`, else \`pointed\`, else the one selected or the one window item: read it with its \`read\` tool, never ask for a file name. Several on screen and none pointed: name the first few from \`window\` and the total, and ask which. "Do you see my page / screen?" is answered from it ("Да: Knowledge, запись <title>"), never with "I cannot see your screen" and never by offering browser automation. state: fresh (use it), stale (say the admin shows nothing current, ask), elsewhere (another project is open), none. ${DATA}`,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => run(async () => readFocus({ file: env.focusFile, slug: project(), repos, now: env.now?.() ?? new Date() })),
  );

  server.registerTool(
    "highlight",
    {
      title: "Point at rows on the owner's screen",
      description: `Draws a ring for ${POINTER_TTL_MS / 1000} s on up to ${POINTER_MAX_REFS} rows of the owner's admin ("покажи, где это", "show me"), with an optional note of at most ${POINTER_NOTE_MAX} characters shown as "Agent: <note>". \`refs\` are refs from \`focus\` (\`knowledge:...\`, \`draft:42\`); \`refs: []\` clears it. A pointer only: it never clicks, types, opens or navigates. A ref not on his screen is offered in the dock as "Agent points at ... · Show"; only his click goes there. Refused unless the focus is fresh, for a ref of another project or one that names nothing, and for more than ${POINTER_MAX_REFS}. The outcome (shown, not-on-screen, dismissed, expired) comes back in \`focus.pointer\` on his next move.`,
      inputSchema: z.object({
        refs: z.array(z.string()).max(POINTER_MAX_REFS).describe("Refs from focus, at most 5; [] clears the pointer."),
        note: z.string().max(POINTER_NOTE_MAX).optional().describe("A few words shown beside the ring, as text."),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ refs, note }) =>
      run(async () => {
        const slug = project();
        if (!env.pointerFile) throw new ToolError("unavailable", "The pointer is not available in this session.");
        const now = env.now?.() ?? new Date();
        if (refs.length) {
          const f = await readFocus({ file: env.focusFile, slug, repos, now, depth: "line" });
          if (f.state !== "fresh") throw new ToolError("not_looking", `The owner is not looking at ${slug}'s admin (focus ${f.state}): say it in words instead.`);
          const today = now.toISOString().slice(0, 10);
          for (const ref of refs) {
            if (!(await resolveRef({ repos, slug, today }, ref))) throw new ToolError("unknown_ref", `${cut(ref, 80)} names nothing in project ${slug}: use a ref from focus.`);
          }
        }
        const rec = writePointer(env.pointerFile, { project: slug, refs, note: note?.trim() ? note.trim() : null, now });
        let live = true;
        try {
          env.pointerWritten?.(slug);
        } catch {
          live = false;
        }
        return refs.length
          ? { id: rec.id, refs, note: rec.note, expiresInSeconds: POINTER_TTL_MS / 1000, live, next: "He sees a ring on each row on his screen; focus.pointer says whether he saw it." }
          : { id: rec.id, cleared: true, live };
      }),
  );
}

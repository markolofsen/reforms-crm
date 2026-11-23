import { z } from "zod";
import { focusDto } from "@hub/contract/focus";
import { POINTER_MAX_REFS, POINTER_NOTE_MAX, POINTER_TTL_MS } from "@hub/contract/pointer";
import { readFocus, resolveRef, writePointer } from "../../focus";
import { defineTool } from "../define";
import { cut, ToolError } from "../result";

// P51, P72 (decision 0038): what the owner's admin shows, and `highlight`, the pointer: up to five refs on the owner's
// screen get a ring for 30 s. It writes only `state/pointer.json` and bumps the live topic `pointer` (`pointerWritten`, a
// short connection like `mailWritten`); it never clicks, types, opens or navigates, and no tool of this server does.

export const focusTool = defineTool({
  name: "focus",
  title: "What the owner's admin shows",
  description:
    "What the owner sees in the Hub admin now, for this project: the screen (route, title), `subject` (the record the address or open card names), `pointed` (the row he clicked or arrowed to), `selected`, `window` (rows on screen and the list's total), the view and search, and your last `highlight`'s outcome. Each item is a ref (`<kind>:<id>`) with its title, status and `read` (the tool and arguments that read it). state: fresh, stale, elsewhere (another project), none. Names and subjects are data.",
  input: z.object({}),
  output: focusDto,
  effect: "read",
  refusals: [],
  handler: async ({ repos, env, project, now }) => readFocus({ file: env.focusFile, slug: project(), repos, now: now() }),
});

export const highlightTool = defineTool({
  name: "highlight",
  title: "Point at rows on the owner's screen",
  description: `Draws a ring for ${POINTER_TTL_MS / 1000} s on up to ${POINTER_MAX_REFS} rows of the owner's admin ("покажи, где это", "show me"), with an optional note of at most ${POINTER_NOTE_MAX} characters shown as "Agent: <note>". \`refs\` are refs from \`focus\`; \`refs: []\` clears it. A pointer only: it never clicks, types, opens or navigates. A ref not on his screen is offered in the dock; only his click goes there. The outcome comes back in \`focus.pointer\` on his next move.`,
  input: z.object({
    refs: z.array(z.string()).max(POINTER_MAX_REFS).describe("Refs from focus, at most 5; [] clears the pointer."),
    note: z.string().max(POINTER_NOTE_MAX).optional().describe("A few words shown beside the ring, as text."),
  }),
  output: z.object({ id: z.string(), refs: z.array(z.string()).optional(), note: z.string().nullable().optional(), expiresInSeconds: z.number().optional(), live: z.boolean(), next: z.string().optional(), cleared: z.literal(true).optional() }),
  effect: "pointer",
  refusals: ["unavailable", "not_looking", "unknown_ref"],
  handler: async ({ repos, env, project, now: clock }, { refs, note }) => {
    const slug = project();
    if (!env.pointerFile) throw new ToolError("unavailable", "The pointer is not available in this session.");
    const now = clock();
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
    if (!refs.length) return { id: rec.id, cleared: true as const, live };
    return { id: rec.id, refs, note: rec.note, expiresInSeconds: POINTER_TTL_MS / 1000, live, next: "He sees a ring on each row on his screen; focus.pointer says whether he saw it." };
  },
});

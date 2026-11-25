import type { LensKit } from "@hub/contract/lens";

// The core's fixture lens (P144 W2): an invented product, acme's garden tools, watched in invented public groups. It is shaped
// like an instance lens (only `import type`, the kit's zod and defineTask) and is type-checked with the core, so the contract a
// real lens is written against is checked even while an instance is linked to the dev core. Its editable half (the version, the
// title, the prompt, the triggers, the keep rule, the window) is `../lens.json`, handed in as `kit.data` (P153).
export default (kit: LensKit) => {
  const { z, data } = kit;
  const triggers = data.triggers.map((t) => t.value);
  const Moment = z.object({
    speaker_role: z.enum(["own_problem", "advising_others", "commenting"]).describe("own_problem only if the person speaks about their OWN garden."),
    is_advert: z.boolean().describe("True if the author sells anything."),
    trigger: z.enum(triggers).describe("The closest trigger."),
    trigger_other: z.string().describe("For trigger=other: the trigger in a few words. Empty otherwise."),
    message_index: z.number().int().min(1).describe("The [n] of the message where the trigger is voiced."),
    reactor_indexes: z.array(z.number().int()).describe("The [n] of messages that react to it."),
    quote: z.string().describe("The trigger words verbatim, under 25 words."),
    thread_context: z.string().describe("One line: what the thread is about."),
    intensity: z.number().int().min(1).max(5).describe("1 = passing remark; 5 = acute."),
    fit_reason: z.string().describe("One sentence: why acme's tools answer this."),
  });
  const Window = z.object({
    threads: z.array(z.string()).describe("The threads in this window, one line each."),
    dominant_topics: z.array(z.string()).describe("The 2 to 5 topics of the window."),
    mood: z.string().describe("The mood in a few words."),
    moments: z.array(Moment).describe("Every trigger moment in the window."),
  });
  return kit.lens({
    id: "acme",
    title: data.title,
    task: kit.defineTask({ name: "watch.acme", version: data.version, schema: Window, system: data.prompt, window: { size: data.window?.size ?? 100, overlap: data.window?.overlap ?? 20, list: "moments" }, ...(data.budgetUsd ? { budgetUsd: data.budgetUsd } : {}) }),
    facets: {
      trigger: "trigger",
      triggerOther: "trigger_other",
      intensity: "intensity",
      quote: "quote",
      speaker: "message_index",
      reactors: "reactor_indexes",
      context: "thread_context",
      why: "fit_reason",
      ...(data.keep ? { keep: data.keep } : {}),
    },
    window: { topics: "dominant_topics", mood: "mood" },
    labels: Object.fromEntries(data.triggers.map((t) => [t.value, t.label])),
  });
};

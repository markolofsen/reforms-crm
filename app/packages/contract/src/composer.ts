/**
 * The channel-neutral state of an owner-facing composer.
 *
 * The union deliberately keeps body, error, and recovery data attached to the
 * states that can use them. Features may add channel-specific capabilities,
 * but the shared UI never has to infer state from a collection of flags.
 */
export type ComposerState =
  | { state: "idle" }
  | { state: "editing"; body: string }
  | { state: "saving"; body: string }
  | { state: "saved"; body: string; draftId: number | string }
  | { state: "recorded"; body: string }
  | { state: "blocked"; body: string; reason: string }
  | { state: "error"; body: string; message: string }
  | { state: "unavailable"; reason: string };

export type ComposerStateInput = {
  body: string;
  draftId?: number | string;
  editing?: boolean;
  saving?: boolean;
  recorded?: boolean;
  error?: string | null;
  blocked?: string | null;
  unavailable?: string | null;
};

/** Maps feature mutation flags to the one shared composer state vocabulary. */
export function composerStateOf(input: ComposerStateInput): ComposerState {
  if (input.unavailable) return { reason: input.unavailable, state: "unavailable" };
  if (input.error) return { body: input.body, message: input.error, state: "error" };
  if (input.blocked) return { body: input.body, reason: input.blocked, state: "blocked" };
  if (input.saving) return { body: input.body, state: "saving" };
  if (input.recorded) return { body: input.body, state: "recorded" };
  if (input.draftId !== undefined && !input.editing) return { body: input.body, draftId: input.draftId, state: "saved" };
  if (input.editing) return { body: input.body, state: "editing" };
  if (input.body.trim()) return { body: input.body, state: "editing" };
  return { state: "idle" };
}


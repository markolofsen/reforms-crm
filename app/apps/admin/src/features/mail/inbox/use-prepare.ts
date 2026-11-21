"use client";

import { preparePhrase } from "@hub/contract/help";
import { useTerminal } from "@/features/terminal/use-terminal";

/**
 * P96 S2, verdict 7: Prepare reply and Prepare all paste the request naming those clients into this project's agent session,
 * without Enter (`pasteToAgent`): the owner reads it and presses Enter, so he is still the one who starts a run, and no route
 * takes a command. The draft then arrives live at the bottom of the conversation, and the person turns Draft ready (P99).
 */
export function usePrepare(project: string) {
  const { pasteToAgent } = useTerminal();
  return (clients: ReadonlyArray<{ email: string; subject: string }>) => {
    if (clients.length > 0) pasteToAgent(preparePhrase(project, clients));
  };
}

import { useEffect, useRef } from "react";
import type { SendPreviewDto } from "@hub/contract/sending";
import type { SendFlow as DoorFlow } from "@/lib/data/send-door";

/** A mail send's steps through the one door (`useSendFlow` of `lib/data/drafts.ts`, over `lib/data/send-door.ts`). */
export type SendFlow = DoorFlow<SendPreviewDto>;

/** Answers true once per send: the first time it sees `sent`, never again until `sent` has been false. */
export function sendLatch(): (sent: boolean) => boolean {
  let fired = false;
  return (sent) => {
    if (!sent) {
      fired = false;
      return false;
    }
    if (fired) return false;
    fired = true;
    return true;
  };
}

/**
 * Runs `announce` once per send, when the flow first reads `sent`. `announce` is read through a ref: the card passes a
 * new function every render, and a re-render after the refetch must not toast and advance a second time (the second
 * advance would find the sent draft gone from the list and jump to the top of it).
 */
export function useOnSent(sent: boolean, announce: () => void): void {
  const latest = useRef(announce);
  const latch = useRef(sendLatch());
  useEffect(() => {
    latest.current = announce;
  });
  useEffect(() => {
    if (latch.current(sent)) latest.current();
  }, [sent]);
}

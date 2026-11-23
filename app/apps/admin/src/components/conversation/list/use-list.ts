import { useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent } from "react";
import { useGo } from "@/hooks/use-go";
import type { Channel } from "../adapter";
import { focusRow } from "./keys";

/**
 * Opening a conversation, the same in both channels (P127 C2, V5; routes rule 9; closes divergences 2 and 6, P128 F16):
 * a pick from the bare list pushes (Back returns to the list), moving between rows replaces, and a bare list address on a pane wide
 * enough for the split replaces itself with its first row once the pane is measured and the list has settled. `asked` is the
 * conversation the address names; `shown` the one on screen (the first row while the address is bare on a wide pane).
 */
export function useOpen(channel: Channel, k: { asked: number | null; narrow: boolean; measured: boolean; still: boolean }) {
  const go = useGo();
  const { asked, narrow, measured, still } = k;
  const shown = still ? null : (asked ?? (narrow ? null : (channel.ids[0] ?? null)));
  const auto = measured && !narrow && !still && channel.settled && asked === null ? (channel.ids[0] ?? null) : null;
  const to = useEffectEvent((id: number | null) => channel.to(id));
  // The address's query is a dependency too: another replace of the bare list (Messengers dropping an unavailable channel) can
  // land after this one and write the bare address back; the auto-open then runs again instead of leaving it bare (P130 gate).
  const search = useSearchParams().toString();
  useEffect(() => {
    if (auto !== null) go(to(auto), { replace: true });
  }, [auto, go, search]);
  const open = useOpenRow(channel, asked);
  // Back to the list replaces: the conversation's entry is not one more step of Back.
  const back = () => go(channel.to(null), { replace: true });
  return { shown, present: asked !== null, open, back };
}

/** Open one row from code (J/K, Mail's advance after Done, Skip or Send): replace while a conversation is open, else push. */
export function useOpenRow(channel: Pick<Channel, "to" | "refOf">, asked: number | null) {
  const go = useGo();
  return (id: number | null, focus = false) => {
    if (id === null) return;
    go(channel.to(id), { replace: asked !== null });
    document.querySelector(`[data-agent-ref="${channel.refOf(id)}"]`)?.scrollIntoView({ block: "nearest" });
    if (focus) focusRow(channel.refOf(id));
  };
}

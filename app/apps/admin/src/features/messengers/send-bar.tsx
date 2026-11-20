import { SendIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { MessengerSendPreviewDto } from "@hub/contract/messenger-panel";
import { ActionButton } from "@hub/ui/product/action-button";
import type { SendFlow } from "@/components/send/send-flow";
import { SendNotices } from "@/components/send/send-notices";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { confirmLine } from "./labels";

type Door = { flow: SendFlow<MessengerSendPreviewDto>; read: () => void; send: (p: MessengerSendPreviewDto) => void; close: () => void };

/**
 * The send part of a messenger draft (P71 M4), as Mail's action bar does it: Send reads the dry run; the confirm swaps the bar in
 * place (who, from which account, "cannot be recalled"), focus on Confirm send, Esc cancels; a refusal lists every reason in words.
 * `rest` is the draft's other buttons (Edit, Skip), hidden while the person confirms.
 */
export function SendBar({ door, name, busy, rest }: { door: Door; name: string; busy: boolean; rest: ReactNode }) {
  const { flow } = door;
  const confirming = flow.step === "confirm";
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) primary.current?.focus();
  }, [confirming]);
  useHotkeys({ escape: () => door.close() }, confirming);
  const preview = flow.step === "confirm" || flow.step === "sending" ? flow.mail : null;
  return (
    <div className="flex flex-col gap-2">
      <SendNotices flow={flow} onClose={door.close} />
      {preview && (
        <p className="text-sm" role="status">
          {confirmLine(preview)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {preview ? (
          <>
            <ActionButton disabled={flow.step === "sending"} onClick={() => flow.step === "confirm" && door.send(flow.mail)} ref={primary} size="s" variant="primary">
              <SendIcon aria-hidden="true" />
              {flow.step === "sending" ? "Sending" : "Confirm send"}
            </ActionButton>
            <ActionButton disabled={flow.step === "sending"} onClick={door.close} size="s" variant="quiet">
              Cancel
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton disabled={busy || flow.step === "reading"} onClick={door.read} size="s" variant="primary">
              <SendIcon aria-hidden="true" />
              {flow.step === "reading" ? "Reading" : "Send"}
              <span className="sr-only"> the reply to {name}</span>
            </ActionButton>
            {rest}
          </>
        )}
      </div>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import type { MessengerSendPreviewDto } from "@hub/contract/messenger";
import { DraftActionRow, DraftSendButton } from "@hub/ui/product/conversation/draft-action-row";
import { ReviewDialog, type ReviewItem } from "@hub/ui/product/conversation/review-dialog";
import { SendIcon } from "lucide-react";
import { flowProblems, type Go, type SendFlow } from "@/lib/data/send-door";
import { confirmLine } from "./labels";

type Door = { flow: SendFlow<MessengerSendPreviewDto>; go: (o?: Go<MessengerSendPreviewDto>) => void; close: () => void };

/**
 * The send part of a messenger draft (P71 M4; P105): the shared draft action row, as Mail's card has it. Send opens the review
 * dialog, whose Send runs the door's dry run and applies it only when it is the text the dialog showed; who and from which account
 * is said once the dry run answers, and a refusal lists every reason as a blocker. `rest` is the draft's other buttons (Edit, Skip).
 */
export function SendBar({ door, name, text, busy, rest }: { door: Door; name: string; /** The draft's text as the panel shows it. */ text: string; busy: boolean; rest: ReactNode }) {
  const { flow } = door;
  const [open, setOpen] = useState(false);
  const running = flow.step === "reading" || flow.step === "sending";
  const close = () => {
    if (running) return;
    setOpen(false);
    door.close();
  };
  const items: ReviewItem[] = flowProblems(flow).map((r, n) => ({ key: `refused-${n}`, severity: "blocker", text: r, action: { label: "Try again", onClick: door.close } }));
  const preview = flow.step === "sending" ? flow.mail : null;
  return (
    <>
      <DraftActionRow primary={<DraftSendButton busy={running} disabled={busy} onClick={() => setOpen(true)} size="s" who={name} />} start={rest} />
      <ReviewDialog
        confirmIcon={<SendIcon aria-hidden="true" />}
        confirmLabel="Send"
        items={items}
        onConfirm={() => door.go({ accept: (p) => (p.text === text ? null : "The draft changed while you read: read it again, then Send.") })}
        onOpenChange={(next) => !next && close()}
        open={open && flow.step !== "sent"}
        pending={running}
        pendingLabel={flow.step === "sending" ? "Sending" : "Checking"}
        summary={
          <div className="flex flex-col gap-1">
            {preview ? <p>{confirmLine(preview)}</p> : <p className="text-muted-foreground">To {name}. A sent message cannot be recalled.</p>}
            <p className="measure whitespace-pre-wrap break-words rounded-lg border bg-card p-3">{text}</p>
          </div>
        }
        title={`Send to ${name}?`}
      />
    </>
  );
}

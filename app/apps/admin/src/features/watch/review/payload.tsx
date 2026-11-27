import Image from "next/image";
import { useState } from "react";
import type { WatchReviewDto } from "@hub/contract/watch-review";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationText } from "@hub/ui/product/conversation";
import { watchProposalPhotoUrl } from "@/lib/data/watch/review";

/** Text and one server-verified immutable photo are the complete payload, both here and in the final review. */
export function ReplyPayload({ review, onPhotoReady }: { review: WatchReviewDto; onPhotoReady?: (ready: boolean) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const p = review.proposal;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="public-reply-payload">
      <ConversationText text={p.text} />
      {p.photo && (
        <figure className="flex min-w-0 flex-col gap-2">
          <Image
            alt="The exact reviewed photo to accompany this public reply"
            className="max-h-72 w-full rounded-md object-contain"
            height={p.photo.height}
            key={attempt}
            onError={() => { setFailed(true); onPhotoReady?.(false); }}
            onLoad={() => { setFailed(false); onPhotoReady?.(true); }}
            src={watchProposalPhotoUrl(p.project, p.id)}
            unoptimized
            width={p.photo.width}
          />
          <figcaption className="break-words text-muted-foreground text-xs">
            Photo · {p.photo.width} × {p.photo.height} · {p.photo.mime} · {p.photo.bytes.toLocaleString("en-US")} bytes
          </figcaption>
          {failed && (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <span className="text-destructive-foreground text-sm">The verified photo preview could not be loaded. Sending waits for it.</span>
              <ActionButton onClick={() => { setFailed(false); onPhotoReady?.(false); setAttempt((n) => n + 1); }} size="s" variant="secondary">Reload preview</ActionButton>
            </div>
          )}
        </figure>
      )}
    </div>
  );
}

import { ActionButton } from "@hub/ui/product/action-button";
import { Alert, AlertDescription, AlertTitle } from "@hub/ui/alert";
import type { SendFlow } from "./send-flow";

/**
 * A refused or failed send is listed whole, with every reason in words and what to do; the bar never hides it. One for every
 * channel: Mail's card and the Messengers panel show the same notice (P71 M4).
 */
export function SendNotices({ flow, onClose }: { flow: SendFlow<unknown>; onClose: () => void }) {
  if (flow.step === "refused")
    return (
      <Alert variant="warning">
        <AlertTitle>
          Not sent: {flow.reasons.length} reason{flow.reasons.length === 1 ? "" : "s"}
        </AlertTitle>
        <AlertDescription>
          <ul className="list-disc ps-5">{flow.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <ActionButton className="mt-2" onClick={onClose} size="s" variant="secondary">Close</ActionButton>
        </AlertDescription>
      </Alert>
    );
  if (flow.step === "failed")
    return (
      <Alert variant="error">
        <AlertTitle>The send failed</AlertTitle>
        <AlertDescription>
          {flow.message}
          <ActionButton className="mt-2" onClick={onClose} size="s" variant="secondary">Close</ActionButton>
        </AlertDescription>
      </Alert>
    );
  return null;
}

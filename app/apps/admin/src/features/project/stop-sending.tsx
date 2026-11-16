import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Radio, RadioGroup } from "@/components/ui/radio-group";

type Props = { project: string; stopped: readonly string[]; busy: boolean; onStop: (scope: string) => void; onResume: (scope: string) => void };

/**
 * The one switch that halts sending. While sending runs there is one "Stop sending"; pressing it asks inline (no
 * dialog) which scope, because stopping is cheap to undo but a surprise to find. While it is stopped, Resume sits at
 * the same size and weight as Stop: undoing must be as easy as doing.
 */
export function StopSending({ project, stopped, busy, onStop, onResume }: Props) {
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState(project);
  const all = stopped.includes("*");
  const mine = stopped.includes(project);
  if (all || mine) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="warning">
          <AlertDescription>
            Sending is stopped {all ? "for every project" : `for ${project}`}: nothing goes out and queued sends were cancelled.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          {all && (
            <ActionButton disabled={busy} onClick={() => onResume("*")} size="m" variant="secondary">
              Resume every project
            </ActionButton>
          )}
          {mine && (
            <ActionButton disabled={busy} onClick={() => onResume(project)} size="m" variant="secondary">
              Resume {project}
            </ActionButton>
          )}
        </div>
      </div>
    );
  }
  if (!asking) {
    return (
      <div>
        <ActionButton disabled={busy} onClick={() => setAsking(true)} size="m" variant="danger">
          Stop sending
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3" role="group" aria-label="Stop sending">
      <p className="text-sm">Stop sending, and cancel what is queued?</p>
      <RadioGroup aria-label="What to stop" onValueChange={(v) => setScope(String(v))} value={scope}>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm lg:min-h-0" htmlFor="stop-scope-project">
          <Radio id="stop-scope-project" value={project} />
          Only {project}
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm lg:min-h-0" htmlFor="stop-scope-all">
          <Radio id="stop-scope-all" value="*" />
          Every project
        </label>
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          disabled={busy}
          onClick={() => {
            setAsking(false);
            onStop(scope);
          }}
          size="m"
          variant="danger"
        >
          Stop sending
        </ActionButton>
        <ActionButton onClick={() => setAsking(false)} size="m" variant="secondary">
          Keep sending
        </ActionButton>
      </div>
    </div>
  );
}

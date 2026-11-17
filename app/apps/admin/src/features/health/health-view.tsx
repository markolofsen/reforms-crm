import { Alert, AlertDescription, AlertTitle } from "@hub/ui/alert";

export type HealthFacts = { apiVersion: number; dataVersion: number; serverTime: string; mailer: string };

/** What the health page says. Plain props, so a test renders it without a browser or a server. */
export function HealthView({ facts, stale }: { facts: HealthFacts | null; stale: boolean }) {
  if (facts === null) {
    return (
      <Alert variant={stale ? "error" : "info"}>
        <AlertTitle>{stale ? "The API did not answer" : "Asking the API"}</AlertTitle>
        <AlertDescription>{stale ? "GET /api/pulse failed through the rewrite. Is the server running? Start it with `hub up`." : "GET /api/pulse"}</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="font-medium" role="status">
        The API answered through the rewrite.
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">API version</dt>
        <dd>{facts.apiVersion}</dd>
        <dt className="text-muted-foreground">Data version</dt>
        <dd>{facts.dataVersion}</dd>
        <dt className="text-muted-foreground">Mailer</dt>
        <dd>{facts.mailer}</dd>
        <dt className="text-muted-foreground">Server time</dt>
        <dd>{facts.serverTime}</dd>
      </dl>
    </div>
  );
}

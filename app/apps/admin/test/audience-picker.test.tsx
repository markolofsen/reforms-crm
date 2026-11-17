import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AudienceDto } from "@hub/contract/responses";
import { AudiencePicker, type AudienceClient } from "../src/features/drafts/audience-picker";

const client = (id: number, reason: AudienceClient["reason"]): AudienceClient => ({ id, name: `Client ${id}`, email: `c${id}@x.example`, repliesOwed: false, lastContactAt: null, marks: [], reason });
const noop = () => undefined;

function render(clients: AudienceClient[]): string {
  const data: AudienceDto = { counts: { all: clients.length, silent: 0, owed: 0 } as AudienceDto["counts"], eligible: clients.filter((c) => !c.reason).length, clients };
  return renderToStaticMarkup(
    <AudiencePicker audience="all" clients={clients} data={data} days={30} eligible={data.eligible} error={null} loading={false} now={0} onAll={noop} onAudience={noop} onNone={noop} onRetry={noop} onSilentDays={noop} onToggle={noop} selected={0} silentDays="30" unticked={new Set()} />,
  );
}

describe("the batch builder says why clients are left out once", () => {
  const html = render([client(1, "open_draft"), client(2, "open_draft"), client(3, null)]);
  it("the Left out line carries the count and the reason", () => {
    expect(html).toContain("Left out: 2 already has an open draft.");
  });
  it("no row repeats the reason as a visible badge; a screen reader still gets it on each left-out row", () => {
    expect(html).not.toMatch(/data-slot="badge"[^>]*>Already has an open draft/);
    expect(html.match(/<span class="sr-only">Already has an open draft<\/span>/g)).toHaveLength(2);
  });
  it("a left-out row keeps its disabled, named tick", () => {
    expect(html).toMatch(/aria-label="Include Client 1"[^>]*disabled|disabled[^>]*aria-label="Include Client 1"/);
  });
});

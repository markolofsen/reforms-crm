import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HealthView } from "../src/features/health/health-view";

describe("health page", () => {
  it("shows what GET /api/pulse answered, and says so when the API is down", () => {
    const up = renderToStaticMarkup(<HealthView facts={{ apiVersion: 4, dataVersion: 7, serverTime: "2026-11-15T10:00:00Z", mailer: "fake" }} stale={false} />);
    expect(up).toContain("The API answered through the rewrite.");
    expect(up).toContain("fake");
    const down = renderToStaticMarkup(<HealthView facts={null} stale />);
    expect(down).toContain("The API did not answer");
  });
});

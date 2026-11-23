import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommitField, SettingSwitch } from "../src/product/field";

// P127 B1 (V10): the owner switch and the save-on-blur field hold state rule 6 by construction: disabled while the save runs, the failure inline.
describe("SettingSwitch", () => {
  it("is enabled at rest and says no alert", () => {
    const html = renderToStaticMarkup(<SettingSwitch checked id="s" label="Advisor" onChange={() => {}} pending={false} />);
    expect(html).toContain('aria-label="Advisor"');
    expect(html).not.toContain("disabled");
    expect(html).not.toContain('role="alert"');
  });
  it("is disabled and busy while its save runs, and says the failure under it", () => {
    const html = renderToStaticMarkup(<SettingSwitch checked={false} error="Not saved: the server refused" id="s" label="Advisor" onChange={() => {}} pending />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Not saved: the server refused");
  });
});

describe("CommitField", () => {
  it("shows the stored value, enabled at rest", () => {
    const html = renderToStaticMarkup(<CommitField id="days" label="Quiet days" onCommit={() => {}} pending={false} value="3" />);
    expect(html).toContain('value="3"');
    expect(html).toContain('aria-label="Quiet days"');
    expect(html).not.toContain("disabled");
  });
  it("is disabled while its save runs and says the failure under it", () => {
    const html = renderToStaticMarkup(<CommitField error="Not saved" id="days" onCommit={() => {}} pending value="3" />);
    expect(html).toContain("disabled");
    expect(html).toContain('role="alert"');
  });
});

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TelegramIcon, WhatsAppIcon } from "../src/product/conversation/channel-icons";

// P102 S1: the two brand marks are lucide components that follow the text colour and carry no colour of their own.
describe("channel icons", () => {
  for (const [name, Icon] of [["telegram", TelegramIcon], ["whatsapp", WhatsAppIcon]] as const) {
    it(`${name} renders a lucide svg in currentColor and takes size`, () => {
      const html = renderToStaticMarkup(<Icon aria-hidden="true" className="text-primary" size={16} />);
      expect(html).toMatch(/^<svg[^>]* class="[^"]*\blucide\b/);
      expect(html).toContain(`lucide-${name}`);
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('width="16"');
      expect(html).toContain('height="16"');
      expect(html).toContain("text-primary");
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('stroke="none"');
    });
  }

  it("holds no hex colour in its source", () => {
    expect(readFileSync(new URL("../src/product/conversation/channel-icons.tsx", import.meta.url), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

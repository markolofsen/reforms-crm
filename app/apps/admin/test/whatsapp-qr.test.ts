import { describe, expect, it } from "vitest";
import { waConnectStepDto } from "@hub/contract/messengers";
import { QR_MARGIN, qrPath, qrSide } from "../src/features/messengers/settings/whatsapp/qr";

// P71 M5: the WhatsApp pairing's QR code is drawn from the server's module rows; the reply never carries the QR string.

describe("the WhatsApp QR code", () => {
  it("draws one square per dark module, inside a four-module quiet zone", () => {
    expect(qrPath(["10", "01"])).toBe(`M${QR_MARGIN} ${QR_MARGIN}h1v1h-1zM${1 + QR_MARGIN} ${1 + QR_MARGIN}h1v1h-1z`);
    expect(qrSide(21)).toBe(29);
  });

  it("the state reply admits rows of 0 and 1 only, so no QR string or other text can come back as a row", () => {
    const row = "0".repeat(21);
    expect(waConnectStepDto.safeParse({ step: "qr", size: 21, rows: [row] }).success).toBe(true);
    expect(waConnectStepDto.safeParse({ step: "qr", size: 21, rows: ["2@ref,noise,identity,secret-padding-to-21"] }).success).toBe(false);
    expect(waConnectStepDto.safeParse({ step: "qr", size: 21, rows: [row], qr: "2@ref" }).success).toBe(false);
  });
});

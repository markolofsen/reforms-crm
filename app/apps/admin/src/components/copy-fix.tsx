"use client";

import { CopyIcon } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { copyText } from "@/lib/external";

/**
 * The copy button of a fix line (P57): the line goes to the clipboard, and the status says so for a screen reader. Shared by the
 * terminal's fix lines and the core update command (P68).
 */
export function CopyFix({ fix, label }: { fix: string; label?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <>
      <ActionButton aria-label={label ?? `Copy ${fix}`} icon onClick={() => void copyText(fix).then((ok) => setSaid(ok ? `Copied: ${fix}` : "The browser refused the clipboard: select the line and copy it."))} size="s" variant="quiet">
        <CopyIcon aria-hidden="true" />
      </ActionButton>
      <span className="sr-only" role="status">{said}</span>
    </>
  );
}

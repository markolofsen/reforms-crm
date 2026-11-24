import type { ReactNode } from "react";
import { LeadsScreen } from "@/features/mail/leads/section";

/** Mail ▸ Leads (P134) lives in this layout so its list stays mounted between /mail/leads and /mail/leads/<page>. */
export default function LeadsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LeadsScreen />
      {children}
    </>
  );
}

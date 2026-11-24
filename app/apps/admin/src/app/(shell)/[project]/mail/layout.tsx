import type { ReactNode } from "react";
import { MailScreen } from "@/features/mail/section";

/** The Mail screen lives in the layout so the list stays mounted between /mail and /mail/c/<client>; the pages add only the title. Mail ▸ Leads has its own layout (P134). */
export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MailScreen />
      {children}
    </>
  );
}

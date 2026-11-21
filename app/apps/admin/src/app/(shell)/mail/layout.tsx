import type { ReactNode } from "react";
import { MailScreen } from "@/features/mail/section";

/** The Mail screen lives in the layout so the list stays mounted between /mail, /mail/c/<client> and /mail/lead/<page>; the pages add only the title. */
export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MailScreen />
      {children}
    </>
  );
}

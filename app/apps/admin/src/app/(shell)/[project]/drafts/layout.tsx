import type { ReactNode } from "react";
import { DraftsScreen } from "@/features/drafts/section";

/** The Drafts screen lives in the layout so the list stays mounted between /drafts and /drafts/<id>; the pages add only the title. */
export default function DraftsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DraftsScreen />
      {children}
    </>
  );
}

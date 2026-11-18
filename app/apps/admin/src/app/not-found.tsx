import type { Metadata } from "next";
import { NotFound } from "@/components/not-found";
import { NOT_FOUND_TITLE } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: NOT_FOUND_TITLE } };

// An address no file of the tree matches. There is no catch-all page (it would make every string a valid typed route),
// so this renders outside the shell, centred, with the one link that leads back.
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-svh measure items-center justify-center p-6">
      <NotFound />
    </main>
  );
}

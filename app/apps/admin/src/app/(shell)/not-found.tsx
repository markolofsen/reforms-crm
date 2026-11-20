import type { Metadata } from "next";
import { NotFound } from "@/components/not-found";
import { Page } from "@hub/ui/product/page";
import { NOT_FOUND_TITLE } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: NOT_FOUND_TITLE } };

// A page of the file tree refused its address (`/mail/abc`): Not found inside the shell, with its way back.
export default function ShellNotFound() {
  return (
    <Page>
      <NotFound />
    </Page>
  );
}

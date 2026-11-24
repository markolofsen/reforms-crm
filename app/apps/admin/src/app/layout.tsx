import type { Metadata } from "next";
import type { ReactNode } from "react";
import { instanceName } from "./instance-name";
import { Providers } from "./providers";
import "../index.css";

// Every page is rendered per request: the data is a mail tool's, never baked in at build time (P32 R3; also the only
// way `/_not-found` prerenders without a Suspense boundary around `useSearchParams`).
export const dynamic = "force-dynamic";
// P133: the one place the instance's name enters a title. A page names its route ("Mail · lisbon", `pageTitle`); the
// template appends the instance ("Mail · lisbon · Hub SaaS"), so two instances open side by side tell their tabs apart.
export function generateMetadata(): Metadata {
  const name = instanceName();
  return { title: { default: name, template: `%s · ${name}` } };
}

// The theme is the ThemeProvider's (in `Providers`, `@hub/ui/product/shell/theme`): its blocking script sets the `.dark` class before
// paint, so `<html>` carries `suppressHydrationWarning` (the class is not in the server markup).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="isolate">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}

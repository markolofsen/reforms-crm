import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "../index.css";

// Every page is rendered per request: the data is a mail tool's, never baked in at build time (P32 R3; also the only
// way `/_not-found` prerenders without a Suspense boundary around `useSearchParams`).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Hub Workflow", template: "%s | Hub" } };

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

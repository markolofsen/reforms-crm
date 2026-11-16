import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "../index.css";

// Every page is rendered per request: the data is a mail tool's, never baked in at build time (P32 R3; also the only
// way `/_not-found` prerenders without a Suspense boundary around `useSearchParams`).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Hub Workflow", template: "%s | Hub" } };

// Follow the system colour scheme (coss tokens switch on the .dark class). Runs before paint; `suppressHydrationWarning`
// on <html> because the class it sets is not in the server markup.
const THEME = `(function(){var mq=matchMedia("(prefers-color-scheme: dark)");var a=function(){document.documentElement.classList.toggle("dark",mq.matches)};a();mq.addEventListener("change",a)})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <div className="isolate">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}

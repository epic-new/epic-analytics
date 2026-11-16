import { EpicScript } from "@epicnew/analytics/next";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <EpicScript />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { WorkspaceFrame } from "./WorkspaceFrame";
import "./styles.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// The Content Security Policy carries a nonce made for each request (see
// `proxy.ts`), so pages are rendered per request rather than at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations | BJH Logistics",
  description:
    "Manage customer records and quotation requests in the BJH Logistics staff workspace.",
  // Name under the icon when added to an iPhone or iPad home screen.
  appleWebApp: { title: "BJH Logistics", statusBarStyle: "default" },
};

// The browser's address bar takes the brand blue on phones.
export const viewport: Viewport = { themeColor: "#0b3fae" };

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <WorkspaceFrame>{children}</WorkspaceFrame>
      </body>
    </html>
  );
}

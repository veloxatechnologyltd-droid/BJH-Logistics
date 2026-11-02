import type { Metadata } from "next";
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
};

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

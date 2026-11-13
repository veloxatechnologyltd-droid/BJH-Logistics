import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_URL } from "./content";
import { JsonLd } from "./JsonLd";
import { ScrollEffects } from "./ScrollEffects";
import { OG_IMAGE, organizationJsonLd, SITE_NAME, websiteJsonLd } from "./seo";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { WhatsAppButton } from "./WhatsAppButton";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "BJH Logistics | Freight forwarding and customs clearance in Ghana",
    template: "%s | BJH Logistics",
  },
  description:
    "Sea, air and road freight, customs clearance, warehousing and project cargo from Tema, Ghana. Request a quote from BJH Logistics.",
  // Fallback for routes that set no social metadata of their own (e.g. 404).
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GH",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GH" className={inter.variable}>
      <body>
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        <WhatsAppButton />
        <ScrollEffects />
        <Analytics />
      </body>
    </html>
  );
}

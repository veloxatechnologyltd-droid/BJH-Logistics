import type { Metadata } from "next";
import { ContactSection } from "../ContactSection";
import { PageHero } from "../Sections";
import { pageMetadata } from "../seo";

export const metadata: Metadata = pageMetadata({
  title: "Contact Us in Tema, Ghana",
  description:
    "Call, WhatsApp, email or visit BJH Logistics in Tema Community 1, Ghana.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact us" title="Talk to our team">
        Call, message or visit us. For prices, the quickest route is our quote
        request form.
      </PageHero>

      <ContactSection />
    </>
  );
}

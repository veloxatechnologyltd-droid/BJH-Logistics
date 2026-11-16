import type { Metadata } from "next";
import { PageHero } from "../../Sections";
import { TrackForm } from "../TrackForm";
import { TrackingResult } from "../TrackingResult";

type Props = { params: Promise<{ number: string }> };

// A tracking link belongs to one customer: search engines must not list it.
export const metadata: Metadata = {
  title: "Track Your Shipment",
  robots: { index: false, follow: false },
};

export default async function TrackingPage({ params }: Props) {
  const { number } = await params;
  const typed = decodeURIComponent(number);
  return (
    <>
      <PageHero eyebrow="Track a shipment" title="Your shipment" />
      <section className="section">
        <div className="container track-layout">
          <TrackingResult number={typed} />
          <details className="track-another">
            <summary>Track another shipment</summary>
            <TrackForm />
          </details>
        </div>
      </section>
    </>
  );
}

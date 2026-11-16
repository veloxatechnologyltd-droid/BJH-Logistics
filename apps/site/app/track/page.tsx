import type { Metadata } from "next";
import { PageHero } from "../Sections";
import { pageMetadata } from "../seo";
import { TrackForm } from "./TrackForm";

export const metadata: Metadata = pageMetadata({
  title: "Track Your Shipment",
  description:
    "Enter the tracking number BJH Logistics sent you to see where your shipment is and when it is expected.",
  path: "/track",
});

export default function TrackPage() {
  return (
    <>
      <PageHero eyebrow="Track a shipment" title="Where is my shipment?">
        Enter the tracking number we sent you when your shipment was registered.
      </PageHero>
      <section className="section">
        <div className="container track-layout">
          <TrackForm />
        </div>
      </section>
    </>
  );
}

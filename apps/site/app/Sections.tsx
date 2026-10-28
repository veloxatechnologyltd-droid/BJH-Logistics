import Link from "next/link";
import type { ReactNode } from "react";
import { contact, telHref, whatsappHref } from "./content";
import { Icon } from "./Icon";

export function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="page-hero">
      <div className="hero-grid" aria-hidden="true" />
      <div className="container">
        <p className="eyebrow light">{eyebrow}</p>
        <h1>{title}</h1>
        {children ? <p className="lead">{children}</p> : null}
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  center,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`section-heading reveal${center ? " center" : ""}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children ? <p className="section-lead">{children}</p> : null}
    </div>
  );
}

export function CtaBand() {
  return (
    <section className="cta-band">
      <div className="container cta-inner reveal">
        <div>
          <h2>Ready to move your cargo?</h2>
          <p>
            Tell us what you are shipping and we will come back with a quote.
            Prefer to talk? Call {contact.hotline} or message us on WhatsApp.
          </p>
        </div>
        <div className="cta-actions">
          <Link href="/request-a-quote" className="btn btn-white">
            Request a quote <Icon name="arrow" size={18} />
          </Link>
          <a
            href={whatsappHref()}
            className="btn btn-outline-white"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="whatsapp" size={18} /> WhatsApp
          </a>
          <a href={telHref(contact.hotline)} className="btn btn-outline-white">
            <Icon name="phone" size={18} /> Call us
          </a>
        </div>
      </div>
    </section>
  );
}

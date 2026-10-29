import type { Metadata } from "next";
import { Suspense } from "react";
import { contact, quoteChecklist, telHref, whatsappHref } from "../content";
import { Icon } from "../Icon";
import { PageHero } from "../Sections";
import { QuoteForm } from "./QuoteForm";

export const metadata: Metadata = {
  title: "Request a quote",
  description:
    "Send your shipment details to BJH Logistics and get a freight, customs or logistics quote.",
};

export default function RequestQuotePage() {
  return (
    <>
      <PageHero eyebrow="Request a quote" title="Tell us about your shipment">
        The more detail you give, the faster and more accurate your quote.
        Fields marked * are required.
      </PageHero>

      <section className="section">
        <div className="container quote-layout">
          <Suspense>
            <QuoteForm />
          </Suspense>

          <aside className="quote-aside reveal from-right">
            <h2>Prefer to talk?</h2>
            <p>Our team can take your details by phone or WhatsApp.</p>
            <a href={telHref(contact.hotline)} className="aside-link">
              <Icon name="phone" size={20} /> {contact.hotline}
            </a>
            <a href={telHref(contact.telephone)} className="aside-link">
              <Icon name="phone" size={20} /> {contact.telephone}
            </a>
            <a
              href={whatsappHref()}
              className="aside-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="whatsapp" size={20} /> {contact.whatsapp}
            </a>
            <a href={`mailto:${contact.quotesEmail}`} className="aside-link">
              <Icon name="mail" size={20} /> {contact.quotesEmail}
            </a>
            <h3>For an accurate quotation, include</h3>
            <ul className="checklist">
              {quoteChecklist.map((item) => (
                <li key={item}>
                  <Icon name="check" size={16} /> {item}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
    </>
  );
}

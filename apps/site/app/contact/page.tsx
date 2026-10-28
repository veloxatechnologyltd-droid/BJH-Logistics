import type { Metadata } from "next";
import Link from "next/link";
import { contact, telHref, whatsappHref } from "../content";
import { Icon } from "../Icon";
import { PageHero } from "../Sections";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Call, WhatsApp, email or visit BJH Logistics in Tema Community 1, Ghana.",
};

export default function ContactPage() {
  const cards = [
    {
      icon: "phone" as const,
      title: "Call the hotline",
      text: contact.hotline,
      href: telHref(contact.hotline),
    },
    {
      icon: "whatsapp" as const,
      title: "WhatsApp",
      text: contact.whatsapp,
      href: whatsappHref(),
      external: true,
    },
    {
      icon: "mail" as const,
      title: "General enquiries",
      text: contact.enquiriesEmail,
      href: `mailto:${contact.enquiriesEmail}`,
    },
    {
      icon: "mail" as const,
      title: "Quotes",
      text: contact.quotesEmail,
      href: `mailto:${contact.quotesEmail}`,
    },
  ];

  return (
    <>
      <PageHero eyebrow="Contact us" title="Talk to our team">
        Call, message or visit us. For prices, the quickest route is our quote
        request form.
      </PageHero>

      <section className="section">
        <div className="container contact-layout">
          <div className="contact-cards">
            {cards.map((card, index) => (
              <a
                key={card.title}
                href={card.href}
                className="contact-card reveal"
                style={{ transitionDelay: `${index * 80}ms` }}
                {...(card.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <span className="icon-box">
                  <Icon name={card.icon} />
                </span>
                <span>
                  <strong>{card.title}</strong>
                  <span>{card.text}</span>
                </span>
              </a>
            ))}
          </div>

          <div className="office-card reveal from-right">
            <span className="icon-box">
              <Icon name="pin" />
            </span>
            <h2>Our office</h2>
            <address>
              {contact.address.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
            <div className="office-actions">
              <a
                href={contact.mapUrl}
                className="btn btn-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Google Maps <Icon name="arrow" size={18} />
              </a>
              <Link href="/request-a-quote" className="btn btn-ghost-dark">
                Request a quote
              </Link>
            </div>
            <div className="socials dark-links">
              {contact.socials.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {social.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

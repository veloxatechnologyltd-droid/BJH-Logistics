import type { Metadata } from "next";
import Link from "next/link";
import { contact, telHref } from "../content";
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
      icon: "mail" as const,
      title: "Import/export quote request",
      links: contact.quoteEmails.map((email) => ({
        text: email,
        href: `mailto:${email}`,
      })),
    },
    {
      icon: "mail" as const,
      title: "General enquiries",
      links: contact.generalEmails.map((email) => ({
        text: email,
        href: `mailto:${email}`,
      })),
    },
    {
      icon: "phone" as const,
      title: "Telephone / WhatsApp",
      links: contact.phoneNumbers.map((phone) => ({
        text: phone,
        href: telHref(phone),
        whatsapp: `https://wa.me/${phone.replace(/\D/g, "")}`,
      })),
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
              <div
                key={card.title}
                className="contact-card reveal"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <span className="icon-box">
                  <Icon name={card.icon} />
                </span>
                <span>
                  <strong>{card.title}</strong>
                  {card.links.map((item) => (
                    <span key={item.text}>
                      <a href={item.href}>{item.text}</a>
                      {"whatsapp" in item && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={item.whatsapp}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            WhatsApp
                          </a>
                        </>
                      )}
                    </span>
                  ))}
                </span>
              </div>
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

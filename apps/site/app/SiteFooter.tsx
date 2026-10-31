import Link from "next/link";
import { contact, featuredServices, FOUNDED, telHref } from "./content";
import { Icon } from "./Icon";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="logo" aria-label="BJH Logistics home">
            <span className="logo-mark">BJH</span>
            <span className="logo-text">Logistics</span>
          </Link>
          <p className="footer-about">
            {contact.tagline}, since {FOUNDED}.
          </p>
          <div className="socials">
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

        <div>
          <h3>Services</h3>
          <ul>
            {featuredServices.map((service) => (
              <li key={service.slug}>
                <Link href={`/services#${service.slug}`}>{service.title}</Link>
              </li>
            ))}
            <li>
              <Link href="/services">All services</Link>
            </li>
          </ul>
        </div>

        <div>
          <h3>Company</h3>
          <ul>
            <li>
              <Link href="/about">About us</Link>
            </li>
            <li>
              <Link href="/projects">Projects</Link>
            </li>
            <li>
              <Link href="/contact">Contact</Link>
            </li>
            <li>
              <Link href="/request-a-quote">Request a quote</Link>
            </li>
          </ul>
        </div>

        <div>
          <h3>Contact</h3>
          <ul className="footer-contact">
            <li>
              <Icon name="pin" size={18} />
              <span>{contact.address.join(", ")}</span>
            </li>
            {contact.phoneNumbers.map((phone) => (
              <li key={phone}>
                <Icon name="phone" size={18} />
                <a href={telHref(phone)}>{phone}</a>
              </li>
            ))}
            {[...new Set([...contact.quoteEmails, ...contact.generalEmails])].map(
              (email) => (
                <li key={email}>
                  <Icon name="mail" size={18} />
                  <a href={`mailto:${email}`}>{email}</a>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        © {new Date().getFullYear()} {contact.company}. All rights reserved.
      </div>
    </footer>
  );
}

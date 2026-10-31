import Link from "next/link";
import Image from "next/image";
import { contact, featuredServices, FOUNDED } from "./content";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="logo" aria-label="BJH Logistics home">
            <Image
              src="/images/bjh-logo.png"
              alt="BJH Logistics"
              width={1006}
              height={390}
              className="brand-logo"
            />
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
      </div>
      <div className="container footer-bottom">
        © {new Date().getFullYear()} {contact.company}. All rights reserved.
      </div>
    </footer>
  );
}

import Link from "next/link";
import Image from "next/image";
import {
  allServices,
  affiliations,
  benefits,
  carriers,
  contact,
  customers,
  faqs,
  featuredServices,
  FOUNDED,
  processSteps,
  whatsappHref,
} from "./content";
import { Icon } from "./Icon";
import { HeroShowcase } from "./HeroShowcase";
import { CtaBand, SectionHeading } from "./Sections";

const yearsInBusiness = new Date().getFullYear() - FOUNDED;
const partnerLogos: Record<string, string> = {
  Maersk: "/images/partners/maersk.svg",
  Evergreen: "/images/partners/evergreen-line.svg",
  "Hapag-Lloyd": "/images/partners/hapag-lloyd.png",
  PIL: "/images/partners/pil.png",
  GIFF: "/images/partners/giff.png",
  Freightnet: "/images/partners/freightnet.png",
  FIATA: "/images/partners/fiata.svg",
  IATA: "/images/partners/iata.svg",
};

export default function HomePage() {
  const marquee = [
    ...carriers.sea,
    ...affiliations.map((affiliation) => affiliation.name),
  ];

  return (
    <>
      <section className="hero">
        <HeroShowcase />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow light">Since {FOUNDED} · Tema, Ghana</p>
            <h1>
              <span className="hero-heading-wide">
                Freight, customs and logistics, <em>handled end to end.</em>
              </span>
              <span className="hero-heading-small">
                Freight, cleared and delivered.
              </span>
            </h1>
            <p className="lead hero-lead-wide">
              BJH Logistics moves your cargo by air, sea and land. We book it,
              clear it, store it and deliver it, so you deal with one team from
              origin to door.
            </p>
            <p className="lead hero-lead-small">
              Air, sea and land logistics from Tema to your door.
            </p>
            <div className="hero-actions">
              <Link href="/request-a-quote" className="btn btn-white">
                Request a quote <Icon name="arrow" size={18} />
              </Link>
              <a
                href={whatsappHref()}
                className="btn btn-outline-white"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="whatsapp" size={18} /> Talk to the team
              </a>
            </div>
            <ul className="hero-pills">
              <li>
                <Icon name="plane" size={18} /> Air
              </li>
              <li>
                <Icon name="ship" size={18} /> Sea
              </li>
              <li>
                <Icon name="truck" size={18} /> Land
              </li>
              <li>
                <Icon name="project" size={18} /> Project cargo
              </li>
            </ul>
          </div>
        </div>
        <a href="#stats" className="scroll-cue" aria-label="Scroll down">
          <span />
        </a>
      </section>

      <section id="stats" className="stats">
        <div className="container stats-grid">
          {[
            {
              value: yearsInBusiness,
              prefix: "",
              suffix: "+",
              label: "Years in business",
            },
            {
              value: allServices.length,
              prefix: "",
              suffix: "",
              label: "Logistics services",
            },
            {
              value: 3,
              prefix: "",
              suffix: "",
              label: "Modes: air, sea and land",
            },
            {
              value: 5,
              prefix: "3–",
              suffix: "",
              label: "Business days to clear at Tema Port",
            },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className="stat reveal"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <p className="stat-value">
                {stat.prefix}
                <span data-count={stat.value}>{stat.value}</span>
                {stat.suffix}
              </p>
              <p className="stat-label">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="What we do"
            title="Logistics services for importers and exporters"
          >
            We coordinate cargo across sea, air and land, and link it with the
            customs, storage, documents and delivery your shipment needs.
          </SectionHeading>
          <div className="card-grid">
            {featuredServices.map((service, index) => (
              <Link
                key={service.slug}
                href={`/services#${service.slug}`}
                className="service-card reveal"
                style={{ transitionDelay: `${(index % 3) * 90}ms` }}
              >
                {service.image && (
                  <Image
                    src={service.image}
                    alt={`Illustrative ${service.title.toLowerCase()} scene`}
                    width={1200}
                    height={650}
                    className="service-card-image"
                  />
                )}
                <span className="icon-box">
                  <Icon name={service.icon} />
                </span>
                <h3>{service.title}</h3>
                <p>{service.summary}</p>
                <span className="card-link">
                  Learn more <Icon name="arrow" size={16} />
                </span>
              </Link>
            ))}
          </div>
          <div className="center-action reveal">
            <Link href="/services" className="btn btn-primary">
              View all {allServices.length} services{" "}
              <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section tinted">
        <div className="container split">
          <div className="reveal from-left">
            <p className="eyebrow">Why BJH Logistics</p>
            <h2>One team for freight, customs and delivery</h2>
            <p className="section-lead">
              Since {FOUNDED}, BJH Logistics has worked from Tema, next to
              Ghana&apos;s principal seaport. Instead of managing each stage of
              a shipment separately, you deal with one commercial contact who
              coordinates them all.
            </p>
            <Link href="/about" className="btn btn-primary">
              About us <Icon name="arrow" size={18} />
            </Link>
          </div>
          <div className="benefit-grid">
            {benefits.map((benefit, index) => (
              <div
                key={benefit.title}
                className="benefit reveal"
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <span className="icon-box">
                  <Icon name={benefit.icon} />
                </span>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="How we work"
            title="Five steps from enquiry to delivery"
            center
          />
          <ol className="process reveal">
            {processSteps.map((step, index) => (
              <li
                key={step.title}
                style={{ transitionDelay: `${200 + index * 160}ms` }}
              >
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section dark">
        <div className="container">
          <SectionHeading
            eyebrow="Who we support"
            title="For importers, exporters and specialist cargo"
          >
            From growing businesses to project cargo teams and offshore
            operators, customers rely on us for freight, customs, storage and
            onward delivery.
          </SectionHeading>
          <div className="card-grid">
            {customers.map((project, index) => (
              <div
                key={project.title}
                className="project-card reveal"
                style={{ transitionDelay: `${(index % 3) * 90}ms` }}
              >
                <span className="icon-box">
                  <Icon name={project.icon} />
                </span>
                <h3>{project.title}</h3>
                <p>{project.summary}</p>
              </div>
            ))}
          </div>
          <div className="center-action reveal">
            <Link href="/projects" className="btn btn-white">
              Specialist capability <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="partners">
        <p className="eyebrow center-text">
          Carrier network and industry affiliations
        </p>
        <div className="marquee" aria-label={marquee.join(", ")}>
          <div className="marquee-track" aria-hidden="true">
            {[...marquee, ...marquee].map((name, index) => (
              <span
                key={`${name}-${index}`}
                className={
                  partnerLogos[name] ? "partner-brand" : "partner-name"
                }
              >
                {partnerLogos[name] ? (
                  <Image
                    src={partnerLogos[name]}
                    alt=""
                    width={190}
                    height={52}
                  />
                ) : (
                  name
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container faq-layout">
          <div className="reveal from-left">
            <p className="eyebrow">Questions</p>
            <h2>Frequently asked questions</h2>
            <p className="section-lead">
              Can&apos;t find your answer? Email{" "}
              <a href={`mailto:${contact.enquiriesEmail}`}>
                {contact.enquiriesEmail}
              </a>
              .
            </p>
          </div>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details
                key={faq.question}
                className="faq reveal"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
